class EpubExtractor {
  /**
   * 初始化EpubExtractor
   * @param {File|Blob} epubFile - EPUB文件对象
   */
  constructor(epubFile) {
    if (!epubFile) {
      throw new Error('请提供EPUB文件');
    }
    this.epubFile = epubFile;
    this.zip = null;
    this.contentOpfPath = null;
    this.chapters = [];
    this.initialized = false;
  }

  /**
   * 初始化解析EPUB文件结构
   * @returns {Promise<void>}
   */
  async init() {
    if (this.initialized) return;

    try {
      // 加载并解析EPUB文件（ZIP格式）
      const JSZip = await this.loadJSZip();
      const arrayBuffer = await this.readFileAsArrayBuffer(this.epubFile);
      this.zip = await JSZip.loadAsync(arrayBuffer);

      // 查找content.opf文件（EPUB的核心元数据文件）
      this.contentOpfPath = await this.findContentOpf();
      if (!this.contentOpfPath) {
        throw new Error('未找到content.opf文件，可能不是有效的EPUB文件');
      }

      // 解析content.opf获取章节信息
      await this.parseContentOpf();

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
    if (window.JSZip) {
      return window.JSZip;
    }
    
    // 如果未加载，则动态导入
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js';
    document.head.appendChild(script);
    
    return new Promise((resolve) => {
      script.onload = () => resolve(window.JSZip);
    });
  }

  /**
   * 读取文件为ArrayBuffer
   * @param {File|Blob} file - 要读取的文件
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
    // 首先检查META-INF/container.xml
    const containerPath = 'META-INF/container.xml';
    const containerFile = this.zip.file(containerPath);
    
    if (containerFile) {
      const content = await containerFile.async('text');
      const parser = new DOMParser();
      const xmlDoc = parser.parseFromString(content, 'text/xml');
      const rootfile = xmlDoc.querySelector('rootfile');
      
      if (rootfile) {
        return rootfile.getAttribute('full-path');
      }
    }
    
    // 如果找不到container.xml，尝试直接查找常见位置的content.opf
    const possiblePaths = [
      'OEBPS/content.opf',
      'content.opf',
      'EPUB/content.opf'
    ];
    
    for (const path of possiblePaths) {
      if (this.zip.file(path)) {
        return path;
      }
    }
    
    return null;
  }

  /**
   * 解析content.opf文件，提取章节信息
   * @returns {Promise<void>}
   */
  async parseContentOpf() {
    const contentOpfFile = this.zip.file(this.contentOpfPath);
    if (!contentOpfFile) {
      throw new Error('找不到content.opf文件');
    }
    
    const content = await contentOpfFile.async('text');
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(content, 'text/xml');
    
    // 获取OPF目录
    const opfDir = this.contentOpfPath.lastIndexOf('/') > -1 
      ? this.contentOpfPath.substring(0, this.contentOpfPath.lastIndexOf('/') + 1) 
      : '';
    
    // 查找所有章节项（item）
    const items = xmlDoc.querySelectorAll('item[media-type="application/xhtml+xml"]');
    
    // 查找spine，确定章节顺序
    const spineItems = xmlDoc.querySelectorAll('spine itemref');
    const idRefs = Array.from(spineItems).map(item => item.getAttribute('idref'));
    
    // 构建章节列表
    this.chapters = idRefs.map(idRef => {
      const item = xmlDoc.querySelector(`item[id="${idRef}"]`);
      if (item) {
        const href = item.getAttribute('href');
        // 计算完整路径
        return {
          id: idRef,
          path: this.resolvePath(opfDir, href)
        };
      }
      return null;
    }).filter(Boolean);
  }

  /**
   * 解析相对路径为完整路径
   * @param {string} basePath - 基础路径
   * @param {string} relativePath - 相对路径
   * @returns {string} 完整路径
   */
  resolvePath(basePath, relativePath) {
    // 处理绝对路径
    if (relativePath.startsWith('/')) {
      return relativePath.substring(1); // 移除开头的斜杠，因为ZIP内部路径通常不包含
    }
    
    // 处理相对路径
    const baseParts = basePath.split('/').filter(part => part);
    const relativeParts = relativePath.split('/').filter(part => part);
    
    for (let i = 0; i < relativeParts.length; i++) {
      if (relativeParts[i] === '..') {
        if (baseParts.length > 0) {
          baseParts.pop();
        }
      } else {
        baseParts.push(relativeParts[i]);
      }
    }
    
    return baseParts.join('/');
  }

  /**
   * 获取章节总数
   * @returns {number} 章节总数
   */
  getChapterCount() {
    return this.chapters.length;
  }

  /**
   * 根据章节序号获取XHTML文件内容
   * @param {number} chapterIndex - 章节序号（从0开始）
   * @returns {Promise<Blob>} XHTML文件的Blob对象
   */
  async getChapterXhtml(chapterIndex) {
    if (!this.initialized) {
      throw new Error('请先调用init()方法初始化');
    }
    
    if (chapterIndex < 0 || chapterIndex >= this.chapters.length) {
      throw new Error(`章节序号无效，有效范围是0到${this.chapters.length - 1}`);
    }
    
    const chapter = this.chapters[chapterIndex];
    const xhtmlFile = this.zip.file(chapter.path);
    
    if (!xhtmlFile) {
      throw new Error(`找不到章节文件: ${chapter.path}`);
    }
    
    // 获取文件内容并转换为Blob
    const content = await xhtmlFile.async('arraybuffer');
    return new Blob([content], { type: 'application/xhtml+xml' });
  }

  /**
   * 根据章节序号获取XHTML文件的URL（可用于iframe等）
   * @param {number} chapterIndex - 章节序号（从0开始）
   * @returns {Promise<string>} 可访问的URL
   */
  async getChapterXhtmlUrl(chapterIndex) {
    const blob = await this.getChapterXhtml(chapterIndex);
    return URL.createObjectURL(blob);
  }
}

// 使用示例
/*
// 假设你有一个文件输入元素
const fileInput = document.getElementById('epubFileInput');

fileInput.addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  
  try {
    const extractor = new EpubExtractor(file);
    await extractor.init();
    
    console.log(`共发现 ${extractor.getChapterCount()} 个章节`);
    
    // 获取第0章的XHTML文件
    const chapterBlob = await extractor.getChapterXhtml(0);
    
    // 可以将blob转换为URL用于展示
    const chapterUrl = URL.createObjectURL(chapterBlob);
    console.log('章节URL:', chapterUrl);
    
    // 或者读取内容
    const reader = new FileReader();
    reader.onload = (event) => {
      console.log('章节内容:', event.target.result);
    };
    reader.readAsText(chapterBlob);
    
  } catch (error) {
    console.error('处理EPUB时出错:', error);
  }
});
*/