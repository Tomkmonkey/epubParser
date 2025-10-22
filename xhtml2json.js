/**
 * 浏览器环境下将XHTML内容解析为JSON（修复选择器兼容性）
 * @param {string} xhtmlContent - XHTML文件的字符串内容
 * @returns {Object} 解析后的JSON对象
 */
function xhtmlToJson(xhtmlContent) {
  // 1. 使用DOMParser解析XHTML内容（XML模式）
  const parser = new DOMParser();
  const doc = parser.parseFromString(xhtmlContent, 'application/xml');

  // 2. 提取所有脚注（修复选择器：用 epub\:type 替代 epub|type）
  const footnotes = {};
  // 关键修复：[epub\:type="footnote"] 转义冒号
  const footnoteElements = doc.querySelectorAll('aside[epub\\:type="footnote"]');
  footnoteElements.forEach(el => {
    const noteId = el.id;
    if (!noteId) return;
    const noteText = el.textContent.trim().replace(/\s+/g, ' ');
    footnotes[noteId] = noteText;
  });

  // 3. 提取正文段落（排除标题性段落）
  const paragraphs = [];
  const paraElements = doc.querySelectorAll('p:not(.title2)');
  paraElements.forEach((el, index) => {
    const paraText = el.textContent.trim().replace(/\s+/g, ' ');
    if (!paraText) return;

    // 4. 收集段落关联的脚注引用（同样修复选择器）
    const footnotesInPara = [];
    // 关键修复：a[epub\:type="noteref"] 转义冒号
    const noteLinks = el.querySelectorAll('a[epub\\:type="noteref"]');
    noteLinks.forEach(link => {
      const href = link.getAttribute('href') || '';
      const noteId = href.replace(/^#/, '');
      if (footnotes[noteId]) {
        footnotesInPara.push({
          id: noteId,
          content: footnotes[noteId]
        });
      }
    });

    paragraphs.push({
      index: index,
      text: paraText,
      footnotes: footnotesInPara
    });
  });

  return {
    metadata: {
      paragraphCount: paragraphs.length,
      footnoteCount: Object.keys(footnotes).length
    },
    paragraphs: paragraphs,
    allFootnotes: footnotes
  };
}

/**
 * 处理上传的XHTML文件并解析为JSON
 * @param {File} file - 上传的XHTML文件对象
 * @param {Function} callback - 解析完成后的回调函数
 */
function parseXhtmlFile(file, callback) {
  if (!file) {
    callback(new Error('未选择文件'));
    return;
  }

  const reader = new FileReader();
  reader.onload = function(e) {
    try {
      const xhtmlContent = e.target.result;
      const result = xhtmlToJson(xhtmlContent);
      callback(null, result);
    } catch (err) {
      callback(err);
    }
  };
  reader.onerror = () => callback(reader.error);
  reader.readAsText(file, 'utf-8');
}

// 暴露全局方法
window.XhtmlToJson = {
  parseContent: xhtmlToJson,
  parseFile: parseXhtmlFile
};
