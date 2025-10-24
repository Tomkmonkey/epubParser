class EpubExtractor {
  constructor(epubFile) {
    if (!epubFile) {
      throw new Error('请提供EPUB文件');
    }
    this.epubFile = epubFile;
    this.zip = null;
    this.contentOpfPath = null;
    this.ncxPath = null; // NCX文件路径
    this.chapters = []; // 结构：{ id, path, title, src }（新增src用于NCX匹配）
    this.initialized = false;
  }

  async init() {
    if (this.initialized) return;

    try {
      const JSZip = await this.loadJSZip();
      const arrayBuffer = await this.readFileAsArrayBuffer(this.epubFile);
      this.zip = await JSZip.loadAsync(arrayBuffer);

      this.contentOpfPath = await this.findContentOpf();
      if (!this.contentOpfPath) {
        throw new Error('未找到content.opf文件，可能不是有效的EPUB文件');
      }

      // 1. 先解析OPF，获取章节基础信息（含src路径）
      await this.parseContentOpf();
      // 2. 解析NCX，通过路径匹配标题（替代顺序匹配）
      if (this.ncxPath) {
        await this.parseNcx();
      }
      // 3. Fallback：未匹配到NCX标题的章节，从XHTML提取
      await this.preloadChapterTitles();

      this.initialized = true;
    } catch (error) {
      console.error('EPUB初始化失败:', error);
      throw error;
    }
  }

  async loadJSZip() {
    if (window.JSZip) {
      return window.JSZip;
    }
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js';
    document.head.appendChild(script);
    return new Promise((resolve) => {
      script.onload = () => resolve(window.JSZip);
    });
  }

  readFileAsArrayBuffer(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsArrayBuffer(file);
    });
  }

  async findContentOpf() {
    const containerPath = 'META-INF/container.xml';
    const containerFile = this.zip.file(containerPath);
    if (containerFile) {
      const content = await containerFile.async('text');
      const xmlDoc = new DOMParser().parseFromString(content, 'text/xml');
      const rootfile = xmlDoc.querySelector('rootfile');
      if (rootfile) return rootfile.getAttribute('full-path');
    }
    const possiblePaths = ['OEBPS/content.opf', 'content.opf', 'EPUB/content.opf'];
    for (const path of possiblePaths) {
      if (this.zip.file(path)) return path;
    }
    return null;
  }

  async parseContentOpf() {
    const contentOpfFile = this.zip.file(this.contentOpfPath);
    if (!contentOpfFile) throw new Error('找不到content.opf文件');

    const content = await contentOpfFile.async('text');
    const xmlDoc = new DOMParser().parseFromString(content, 'text/xml');
    const opfDir = this.contentOpfPath.lastIndexOf('/') > -1 
      ? this.contentOpfPath.substring(0, this.contentOpfPath.lastIndexOf('/') + 1) 
      : '';

    // 关键1：提取NCX文件路径（从manifest的item[id="ncx"]获取）
    const ncxItem = xmlDoc.querySelector('item[id="ncx"]');
    if (ncxItem) {
      this.ncxPath = this.resolvePath(opfDir, ncxItem.getAttribute('href'));
    }

    // 关键2：解析spine章节，新增src字段（用于NCX路径匹配）
    const spineItems = xmlDoc.querySelectorAll('spine itemref');
    const idRefs = Array.from(spineItems).map(item => item.getAttribute('idref'));

    this.chapters = idRefs.map((idRef, index) => {
      const item = xmlDoc.querySelector(`item[id="${idRef}"]`);
      if (!item) return null;

      const href = item.getAttribute('href');
      const fullPath = this.resolvePath(opfDir, href);
      // 新增src字段：NCX中navPoint的src通常是相对路径，需存储原始href用于匹配
      const src = item.getAttribute('href');

      return {
        id: idRef,
        path: fullPath,
        src: src, // 存储原始href，用于NCX路径匹配
        title: `章节${index + 1}` // 默认标题
      };
    }).filter(Boolean);
  }

  /**
   * 优化：解析NCX，通过“路径匹配”关联标题（而非顺序匹配）
   */
  async parseNcx() {
    if (!this.ncxPath) return;
    const ncxFile = this.zip.file(this.ncxPath);
    if (!ncxFile) {
      console.warn('未找到NCX目录文件，将从XHTML提取标题');
      return;
    }

    try {
      const ncxContent = await ncxFile.async('text');
      const xmlDoc = new DOMParser().parseFromString(ncxContent, 'text/xml');
      const ncxNs = 'http://www.daisy.org/z3986/2005/ncx/'; // NCX命名空间

      // 关键：提取NCX中每个标题对应的“章节路径（src）”和“标题文本”
      const navPoints = [];
      const xpath = document.evaluate(
        '//ncx:navMap/ncx:navPoint', // 匹配所有正文章节节点
        xmlDoc,
        (prefix) => prefix === 'ncx' ? ncxNs : null,
        XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
        null
      );

      // 遍历所有navPoint，获取“标题文本”和“对应章节路径（src）”
      for (let i = 0; i < xpath.snapshotLength; i++) {
        const navPoint = xpath.snapshotItem(i);
        // 提取标题文本（navLabel/text）
        const textNode = document.evaluate(
          './ncx:navLabel/ncx:text',
          navPoint,
          (prefix) => prefix === 'ncx' ? ncxNs : null,
          XPathResult.FIRST_ORDERED_NODE_TYPE,
          null
        ).singleNodeValue;
        const title = textNode ? textNode.textContent.replace(/\s+/g, ' ').trim() : null;

        // 提取章节路径（content/src）
        const contentNode = document.evaluate(
          './ncx:content',
          navPoint,
          (prefix) => prefix === 'ncx' ? ncxNs : null,
          XPathResult.FIRST_ORDERED_NODE_TYPE,
          null
        ).singleNodeValue;
        const src = contentNode ? contentNode.getAttribute('src') : null;

        if (title && src) {
          navPoints.push({ src, title }); // 存储“路径-标题”映射
        }
      }

      // 关键：通过src路径匹配章节，而非顺序
      this.chapters.forEach(chapter => {
        // 找到NCX中src与章节src一致的标题
        const matchedNav = navPoints.find(nav => nav.src === chapter.src);
        if (matchedNav) {
          chapter.title = matchedNav.title; // 匹配成功则更新标题
        }
      });

      console.log(`NCX解析完成：匹配到${navPoints.length}个章节标题`);
    } catch (error) {
      console.warn('解析NCX文件失败，将从XHTML提取标题:', error);
    }
  }

  /**
   * Fallback：从XHTML提取标题（未匹配到NCX标题的章节）
   */
  async preloadChapterTitles() {
    if (this.chapters.length === 0) return;

    await Promise.all(
      this.chapters.map(async (chapter, index) => {
        // 仅对“仍为默认标题”的章节进行XHTML提取
        if (chapter.title !== `章节${index + 1}`) return;

        try {
          const xhtmlContent = await this.zip.file(chapter.path).async('text');
          const title = this.extractTitleFromXhtml(xhtmlContent);
          if (title) chapter.title = title;
        } catch (error) {
          console.warn(`解析章节${index + 1}（${chapter.path}）XHTML标题失败:`, error);
        }
      })
    );
  }

  /**
   * 从XHTML提取标题（优先级：h1 > h2 > 带title类的标签 > h3）
   */
  extractTitleFromXhtml(xhtmlContent) {
    const doc = new DOMParser().parseFromString(xhtmlContent, 'text/html');
    const titleSelectors = [
      'h1', 
      'h2', 
      '[class*="title"]', // 匹配含title的类（如chapter-title）
      '[class*="Title"]', 
      'h3'
    ];

    for (const selector of titleSelectors) {
      const element = doc.querySelector(selector);
      if (element) {
        // 清理标题文本（去除多余空格、换行，过滤无意义的短文本）
        const text = element.textContent.replace(/\s+/g, ' ').trim();
        return text.length > 1 ? text : null; // 过滤长度≤1的无意义文本（如“1”“-”）
      }
    }
    return null;
  }

  getOpfDirectory() {
    const lastSlashIndex = this.contentOpfPath.lastIndexOf('/');
    return lastSlashIndex > -1 
      ? this.contentOpfPath.substring(0, lastSlashIndex + 1) 
      : '';
  }

  resolvePath(basePath, relativePath) {
    if (relativePath.startsWith('/')) return relativePath.substring(1);
    const baseParts = basePath.split('/').filter(part => part);
    const relativeParts = relativePath.split('/').filter(part => part);
    for (let i = 0; i < relativeParts.length; i++) {
      if (relativeParts[i] === '..') {
        if (baseParts.length > 0) baseParts.pop();
      } else {
        baseParts.push(relativeParts[i]);
      }
    }
    return baseParts.join('/');
  }

  // ------------------- 原有对外方法（完全未改动） -------------------
  getChapterCount() {
    if (!this.initialized) throw new Error('请先调用init()方法初始化');
    return this.chapters.length;
  }

  getChapterTitles() {
    if (!this.initialized) throw new Error('请先调用init()方法初始化');
    return this.chapters.map(chapter => chapter.title);
  }

  getChapterTitle(chapterIndex) {
    if (!this.initialized) throw new Error('请先调用init()方法初始化');
    if (chapterIndex < 0 || chapterIndex >= this.chapters.length) {
      throw new Error(`章节序号无效，有效范围是0到${this.chapters.length - 1}`);
    }
    return this.chapters[chapterIndex].title;
  }

  async getChapterXhtml(chapterIndex) {
    if (!this.initialized) throw new Error('请先调用init()方法初始化');
    if (chapterIndex < 0 || chapterIndex >= this.chapters.length) {
      throw new Error(`章节序号无效，有效范围是0到${this.chapters.length - 1}`);
    }
    const chapter = this.chapters[chapterIndex];
    const xhtmlFile = this.zip.file(chapter.path);
    if (!xhtmlFile) {
      throw new Error(`找不到章节文件: ${chapter.path}`);
    }
    const content = await xhtmlFile.async('arraybuffer');
    return new Blob([content], { type: 'application/xhtml+xml' });
  }

  async getChapterXhtmlUrl(chapterIndex) {
    const blob = await this.getChapterXhtml(chapterIndex);
    return URL.createObjectURL(blob);
  }
}
