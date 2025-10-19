class EpubParser {
  constructor() {
    this.zip = null;
    this.rootFile = null;
    this.metadata = null;
    this.chapters = [];
    this.contentBasePath = '';
  }

  /**
   * 解析EPUB文件，提取基本信息和章节目录
   * @param {File} file - EPUB文件对象
   * @returns {Promise<Object>} - 包含书籍信息和目录的对象
   */
  async parseFile(file) {
    try {
      // 重置状态
      this.reset();

      // 加载EPUB文件（ZIP）
      this.zip = await JSZip.loadAsync(file);

      // 解析container.xml找到根文件路径
      const containerContent = await this.zip.file('META-INF/container.xml').async('text');
      const containerDoc = new DOMParser().parseFromString(containerContent, 'application/xml');
      const rootfilePath = containerDoc.querySelector('rootfile').getAttribute('full-path');
      this.rootFile = rootfilePath;

      // 提取内容文件的基础路径
      this.contentBasePath = rootfilePath.substring(0, rootfilePath.lastIndexOf('/') + 1);

      // 解析content.opf获取元数据
      const contentOpf = await this.zip.file(rootfilePath).async('text');
      const opfDoc = new DOMParser().parseFromString(contentOpf, 'application/xml');
      
      // 提取元数据
      this.metadata = this.extractMetadata(opfDoc);

      // 提取章节目录
      this.chapters = await this.extractChapters(opfDoc);

      return {
        metadata: this.metadata,
        chapters: this.chapters
      };
    } catch (error) {
      console.error('解析EPUB文件错误:', error);
      throw error;
    }
  }

  /**
   * 从content.opf中提取元数据
   * @param {Document} opfDoc - content.opf的DOM文档
   * @returns {Object} - 书籍元数据
   */
  extractMetadata(opfDoc) {
    const metadata = {};
    
    // 处理命名空间
    const nsResolver = (prefix) => {
      const ns = {
        'dc': 'http://purl.org/dc/elements/1.1/'
      };
      return ns[prefix] || null;
    };
    
    // 标题
    const titleElement = opfDoc.evaluate('//dc:title', opfDoc, nsResolver, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
    metadata.title = titleElement ? titleElement.textContent : '未知标题';
    
    // 作者
    const creatorElement = opfDoc.evaluate('//dc:creator', opfDoc, nsResolver, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
    metadata.author = creatorElement ? creatorElement.textContent : '未知作者';
    
    // 出版社
    const publisherElement = opfDoc.evaluate('//dc:publisher', opfDoc, nsResolver, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
    metadata.publisher = publisherElement ? publisherElement.textContent : '未知出版社';
    
    // 出版日期
    const dateElement = opfDoc.evaluate('//dc:date', opfDoc, nsResolver, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
    metadata.publishedDate = dateElement ? dateElement.textContent : '未知日期';
    
    // 描述
    const descriptionElement = opfDoc.evaluate('//dc:description', opfDoc, nsResolver, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
    metadata.description = descriptionElement ? descriptionElement.textContent : '';
    
    // 语言
    const languageElement = opfDoc.evaluate('//dc:language', opfDoc, nsResolver, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
    metadata.language = languageElement ? languageElement.textContent : '未知语言';
    
    return metadata;
  }

  /**
   * 从content.opf和toc.ncx中提取章节目录
   * @param {Document} opfDoc - content.opf的DOM文档
   * @returns {Promise<Array>} - 章节目录数组
   */
  async extractChapters(opfDoc) {
    // 查找目录文件路径（toc.ncx或nav.xhtml）
    let tocPath = null;
    
    // 尝试从content.opf中找到toc.ncx
    const manifestItems = opfDoc.querySelectorAll('manifest item');
    for (const item of manifestItems) {
      const properties = item.getAttribute('properties');
      const id = item.getAttribute('id');
      const href = item.getAttribute('href');
      
      // EPUB 3使用nav属性标识导航文件
      if (properties && properties.includes('nav')) {
        tocPath = this.resolvePath(href);
        break;
      }
      
      // EPUB 2使用ncx格式的toc
      if (id && id.includes('ncx') && href && href.includes('ncx')) {
        tocPath = this.resolvePath(href);
        break;
      }
    }
    
    if (!tocPath || !this.zip.file(tocPath)) {
      // 如果找不到toc文件，尝试从spine中提取章节
      return this.extractChaptersFromSpine(opfDoc);
    }
    
    // 解析目录文件
    const tocContent = await this.zip.file(tocPath).async('text');
    const tocDoc = new DOMParser().parseFromString(tocContent, 'application/xml');
    
    // 判断是ncx还是xhtml格式的目录
    if (tocPath.endsWith('.ncx')) {
      return this.parseNcxToc(tocDoc);
    } else if (tocPath.endsWith('.xhtml') || tocPath.endsWith('.html')) {
      return this.parseXhtmlToc(tocDoc);
    }
    
    // 如果无法解析目录，从spine提取
    return this.extractChaptersFromSpine(opfDoc);
  }

  /**
   * 从spine中提取章节
   * @param {Document} opfDoc - content.opf的DOM文档
   * @returns {Array} - 章节目录数组
   */
  extractChaptersFromSpine(opfDoc) {
    const chapters = [];
    const spineItems = opfDoc.querySelectorAll('spine itemref');
    const idToHrefMap = {};
    
    // 创建id到href的映射
    opfDoc.querySelectorAll('manifest item').forEach(item => {
      idToHrefMap[item.getAttribute('id')] = item.getAttribute('href');
    });
    
    // 从spine提取章节
    spineItems.forEach((item, index) => {
      const idref = item.getAttribute('idref');
      const href = idToHrefMap[idref];
      
      if (href) {
        chapters.push({
          id: `chapter-${index + 1}`,
          title: `第${index + 1}章`,
          path: this.resolvePath(href),
          order: index + 1
        });
      }
    });
    
    return chapters;
  }

  /**
   * 解析NCX格式的目录
   * @param {Document} ncxDoc - toc.ncx的DOM文档
   * @returns {Array} - 章节目录数组
   */
  parseNcxToc(ncxDoc) {
    const chapters = [];
    const navPoints = ncxDoc.querySelectorAll('navPoint');
    
    navPoints.forEach((navPoint, index) => {
      const id = navPoint.getAttribute('id');
      const order = navPoint.getAttribute('playOrder');
      const titleElement = navPoint.querySelector('navLabel text');
      const contentElement = navPoint.querySelector('content');
      
      if (titleElement && contentElement) {
        chapters.push({
          id: id || `chapter-${index + 1}`,
          title: titleElement.textContent,
          path: this.resolvePath(contentElement.getAttribute('src')),
          order: order ? parseInt(order, 10) : index + 1
        });
      }
    });
    
    return chapters;
  }

  /**
   * 解析XHTML格式的目录（EPUB 3）
   * @param {Document} xhtmlDoc - nav.xhtml的DOM文档
   * @returns {Array} - 章节目录数组
   */
  parseXhtmlToc(xhtmlDoc) {
    const chapters = [];
    const navItems = xhtmlDoc.querySelectorAll('nav[epub|type="toc"] a, nav.toc a');
    
    navItems.forEach((item, index) => {
      const href = item.getAttribute('href');
      if (href) {
        chapters.push({
          id: `chapter-${index + 1}`,
          title: item.textContent.trim(),
          path: this.resolvePath(href),
          order: index + 1
        });
      }
    });
    
    return chapters;
  }

  /**
   * 根据目录项获取章节内容
   * @param {Object} chapter - 目录项对象，包含path属性
   * @returns {Promise<string>} - 章节内容HTML
   */
  async getContent(chapter) {
    if (!this.zip || !chapter || !chapter.path) {
      throw new Error('无效的章节或未加载EPUB文件');
    }
    
    try {
      const contentFile = this.zip.file(chapter.path);
      if (!contentFile) {
        throw new Error(`未找到章节内容文件: ${chapter.path}`);
      }
      
      const content = await contentFile.async('text');
      
      // 处理相对路径的图片和资源
      return this.resolveContentPaths(content, chapter.path);
    } catch (error) {
      console.error('获取章节内容错误:', error);
      throw error;
    }
  }

  /**
   * 处理内容中的相对路径
   * @param {string} content - 章节HTML内容
   * @param {string} chapterPath - 章节文件路径
   * @returns {string} - 处理后的HTML内容
   */
  async resolveContentPaths(content, chapterPath) {
    // 获取章节文件所在的目录
    const chapterDir = chapterPath.substring(0, chapterPath.lastIndexOf('/') + 1);
    
    // 创建一个临时DOM来处理路径
    const tempDoc = document.createElement('div');
    tempDoc.innerHTML = content;
    
    // 处理图片
    const imgElements = tempDoc.querySelectorAll('img');
    for (const img of imgElements) {
      const src = img.getAttribute('src');
      if (src && !src.startsWith('http://') && !src.startsWith('https://')) {
        const absolutePath = this.resolveRelativePath(chapterDir, src);
        img.setAttribute('data-original-src', src);
        img.setAttribute('src', await this.getResourceUrl(absolutePath));
      }
    }
    
    // 处理样式表
    const linkElements = tempDoc.querySelectorAll('link[rel="stylesheet"]');
    for (const link of linkElements) {
      const href = link.getAttribute('href');
      if (href && !href.startsWith('http://') && !href.startsWith('https://')) {
        const absolutePath = this.resolveRelativePath(chapterDir, href);
        link.setAttribute('data-original-href', href);
        link.setAttribute('href', await this.getResourceUrl(absolutePath));
      }
    }
    
    return tempDoc.innerHTML;
  }

  /**
   * 获取资源的URL（使用data URL）
   * @param {string} path - 资源在EPUB中的路径
   * @returns {Promise<string>} - 资源的data URL
   */
  async getResourceUrl(path) {
    try {
      const file = this.zip.file(path);
      if (!file) {
        console.warn(`未找到资源: ${path}`);
        return '';
      }
      
      const content = await file.async('blob');
      return URL.createObjectURL(content);
    } catch (error) {
      console.error(`获取资源 ${path} 错误:`, error);
      return '';
    }
  }

  /**
   * 解析相对路径，返回绝对路径
   * @param {string} basePath - 基础路径
   * @param {string} relativePath - 相对路径
   * @returns {string} - 绝对路径
   */
  resolveRelativePath(basePath, relativePath) {
    // 如果已经是绝对路径，直接返回
    if (relativePath.startsWith('/')) {
      return relativePath.substring(1); // 移除开头的斜杠
    }
    
    const baseParts = basePath.split('/').filter(part => part);
    const relativeParts = relativePath.split('/').filter(part => part);
    
    // 处理相对路径中的..
    for (let i = 0; i < relativeParts.length; i++) {
      if (relativeParts[i] === '..') {
        if (baseParts.length > 0) {
          baseParts.pop();
        }
        relativeParts.splice(i, 1);
        i--;
      } else {
        break;
      }
    }
    
    return [...baseParts, ...relativeParts].join('/');
  }

  /**
   * 基于根文件路径解析相对路径
   * @param {string} relativePath - 相对路径
   * @returns {string} - 绝对路径
   */
  resolvePath(relativePath) {
    return this.resolveRelativePath(this.contentBasePath, relativePath);
  }

  /**
   * 重置解析器状态
   */
  reset() {
    this.zip = null;
    this.rootFile = null;
    this.metadata = null;
    this.chapters = [];
    this.contentBasePath = '';
  }
}
