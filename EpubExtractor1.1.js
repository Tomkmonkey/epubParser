class EpubExtractor {
  constructor(epubFile) {
    if (!epubFile) {
      throw new Error('请提供EPUB文件');
    }
    this.epubFile = epubFile;
    this.zip = null;
    this.contentOpfPath = null;
    this.ncxPath = null; // 新增：存储ncx目录文件路径
    this.chapters = []; // 结构：{ id, path, title }
    this.initialized = false;
  }

  /**
   * 初始化（解析OPF→解析NCX获取标题→XHTML fallback）
   * @returns {Promise<void>}
   */
  async init() {
    if (this.initialized) return;

    try {
      // 1. 加载JSZip并解析EPUB压缩包
      const JSZip = await this.loadJSZip();
      const arrayBuffer = await this.readFileAsArrayBuffer(this.epubFile);
      this.zip = await JSZip.loadAsync(arrayBuffer);

      // 2. 解析OPF：获取章节ID、路径 + NCX文件路径
      await this.parseContentOpf();
      if (!this.contentOpfPath) {
        throw new Error('未找到content.opf文件，可能不是有效的EPUB文件');
      }

      // 3. 优先解析NCX获取章节标题（标准目录来源）
      if (this.ncxPath) {
        await this.parseNcx();
      }

      // 4. Fallback：若NCX解析失败/无标题，从XHTML提取
      await this.preloadChapterTitles();

      this.initialized = true;
    } catch (error) {
      console.error('EPUB初始化失败:', error);
      throw error;
    }
  }

  /**
   * 动态加载JSZip库
   * @returns {Promise<typeof JSZip>}
   */
  async loadJSZip() {
    if (window.JSZip) return window.JSZip;

    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js';
    document.head.appendChild(script);

    return new Promise((resolve) => {
      script.onload = () => resolve(window.JSZip);
    });
  }

  /**
   * 读取文件为ArrayBuffer
   * @param {File|Blob} file - 目标文件
   * @returns {Promise<ArrayBuffer>}
   */
  readFileAsArrayBuffer(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsArrayBuffer(file);
    });
  }

  /**
   * 查找content.opf文件路径
   * @returns {Promise<string|null>}
   */
  async findContentOpf() {
    // 标准方式：从META-INF/container.xml获取
    const containerPath = 'META-INF/container.xml';
    const containerFile = this.zip.file(containerPath);
    if (containerFile) {
      const content = await containerFile.async('text');
      const xmlDoc = new DOMParser().parseFromString(content, 'text/xml');
      const rootfile = xmlDoc.querySelector('rootfile');
      if (rootfile) return rootfile.getAttribute('full-path');
    }

    // Fallback：查找常见路径
    const possiblePaths = ['OEBPS/content.opf', 'content.opf', 'EPUB/content.opf'];
    for (const path of possiblePaths) {
      if (this.zip.file(path)) return path;
    }

    return null;
  }

  /**
   * 解析OPF：1.获取章节ID/路径 2.获取NCX文件路径
   * @returns {Promise<void>}
   */
  async parseContentOpf() {
    this.contentOpfPath = await this.findContentOpf();
    const contentOpfFile = this.zip.file(this.contentOpfPath);
    if (!contentOpfFile) throw new Error('找不到content.opf文件');

    const content = await contentOpfFile.async('text');
    const xmlDoc = new DOMParser().parseFromString(content, 'text/xml');
    const opfDir = this.getOpfDirectory(); // OPF所在目录（用于拼接路径）

    // 关键1：提取NCX文件路径（从manifest的item[id="ncx"]获取）
    const ncxItem = xmlDoc.querySelector('item[id="ncx"]');
    if (ncxItem) {
      this.ncxPath = this.resolvePath(opfDir, ncxItem.getAttribute('href'));
    }

    // 关键2：从spine获取章节顺序，构建章节基础信息
    const spineIdRefs = Array.from(xmlDoc.querySelectorAll('spine itemref'))
      .map(item => item.getAttribute('idref'));

    this.chapters = spineIdRefs.map((idRef, index) => {
      const item = xmlDoc.querySelector(`item[id="${idRef}"]`);
      if (!item) return null;

      return {
        id: idRef,
        path: this.resolvePath(opfDir, item.getAttribute('href')),
        title: `章节${index + 1}` // 默认标题（兜底）
      };
    }).filter(Boolean);
  }

  /**
   * 解析NCX文件（标准目录），提取章节标题
   * @returns {Promise<void>}
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
      const ncxNs = 'http://www.daisy.org/z3986/2005/ncx/'; // NCX标准命名空间

      // 关键：用XPath查询所有章节标题（处理命名空间）
      const xpath = document.evaluate(
        '//ncx:navMap/ncx:navPoint/ncx:navLabel/ncx:text',
        xmlDoc,
        (prefix) => prefix === 'ncx' ? ncxNs : null, // 映射命名空间
        XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
        null
      );

      // 提取标题列表（顺序与spine章节顺序一致）
      const ncxTitles = [];
      for (let i = 0; i < xpath.snapshotLength; i++) {
        const textNode = xpath.snapshotItem(i);
        ncxTitles.push(textNode.textContent.replace(/\s+/g, ' ').trim());
      }

      // 赋值给chapters（标题数量与章节数量匹配时）
      if (ncxTitles.length === this.chapters.length) {
        this.chapters.forEach((chapter, index) => {
          chapter.title = ncxTitles[index];
        });
      } else {
        console.warn(`NCX标题数量(${ncxTitles.length})与章节数量(${this.chapters.length})不匹配`);
      }
    } catch (error) {
      console.warn('解析NCX文件失败，将从XHTML提取标题:', error);
    }
  }

  /**
   * Fallback：从XHTML提取标题（当NCX解析失败时）
   * @returns {Promise<void>}
   */
  async preloadChapterTitles() {
    if (this.chapters.length === 0) return;

    await Promise.all(
      this.chapters.map(async (chapter, index) => {
        // 若NCX已成功提取标题，跳过
        if (chapter.title !== `章节${index + 1}`) return;

        try {
          const xhtmlContent = await this.zip.file(chapter.path).async('text');
          const title = this.extractTitleFromXhtml(xhtmlContent);
          if (title) chapter.title = title;
        } catch (error) {
          console.warn(`解析章节${index + 1}XHTML标题失败:`, error);
        }
      })
    );
  }

  /**
   * 从XHTML内容提取标题（Fallback用）
   * @param {string} xhtmlContent - XHTML文本
   * @returns {string|null} 章节标题
   */
  extractTitleFromXhtml(xhtmlContent) {
    const doc = new DOMParser().parseFromString(xhtmlContent, 'text/html');
    // 匹配常见标题标签（优先级从高到低）
    const titleSelectors = ['h1', 'h2', '[class*="title"]', '[class*="Title"]', 'h3'];
    
    for (const selector of titleSelectors) {
      const element = doc.querySelector(selector);
      if (element) {
        return element.textContent.replace(/\s+/g, ' ').trim();
      }
    }
    return null;
  }

  /**
   * 获取OPF文件所在目录（用于拼接相对路径）
   * @returns {string} 目录路径
   */
  getOpfDirectory() {
    const lastSlashIndex = this.contentOpfPath.lastIndexOf('/');
    return lastSlashIndex > -1 
      ? this.contentOpfPath.substring(0, lastSlashIndex + 1) 
      : '';
  }

  /**
   * 解析相对路径为完整路径
   * @param {string} basePath - 基础路径
   * @param {string} relativePath - 相对路径
   * @returns {string} 完整路径
   */
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

  // ------------------- 对外暴露方法 -------------------
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
    if (!xhtmlFile) throw new Error(`找不到章节文件: ${chapter.path}`);

    const content = await xhtmlFile.async('arraybuffer');
    return new Blob([content], { type: 'application/xhtml+xml' });
  }

  async getChapterXhtmlUrl(chapterIndex) {
    const blob = await this.getChapterXhtml(chapterIndex);
    return URL.createObjectURL(blob);
  }
}
