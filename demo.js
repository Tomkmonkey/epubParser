// ==UserScript==
// @name         import circuit
// @namespace    http://tampermonkey.net/
// @version      1.3.7
// @description  epub解析，显示xhtml段落，支持按钮和键盘切换、进度保存,文本框滚动
// @author       ikun
// @match        https://web.jisupdf.com/*
// @icon         data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAyUlEQVR4AdSQ0RGCQAxEb2xEO1ErUStRK1ErcexEO3Efc5uBwPHDF0zCXTbJI2FTFj7rAey06Vk+sqkVKM6FVwnWfUoqJQPeUvOXaDhIv1V/6ETTMQTQ/JVKoY4w9HuNyH10D4gnoIjmi5J9o4H4yas6miGxAs0/FcRo9c7uR92z7S14Ar68lcj+hnBndOBKhTEtQQc2AMEQfhiQk0TG1RHmuGtG7QOIgbAvo78QkgOIZnIZgIYzOsXcZ70FyHs3IS1AsyEnFgP+AAAA//+PILobAAAABklEQVQDAARgHSHC0ktbAAAAAElFTkSuQmCC
// @grant        none
// @require      https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js
// @require      https://cdn.jsdelivr.net/gh/Tomkmonkey/epubParser@main/xhtml2json.js
// @require      https://cdn.jsdelivr.net/gh/Tomkmonkey/epubParser@main/EpubExtractor3.0.js
// ==/UserScript==

(function() {
    'use strict';
    let fontSize = 10;
    console.log('当前字体大小:', fontSize);
    // 计时与显示控制变量
    let showParagraphflag = 1;
    let timer = null;
    let textView = null;

    // 控制显示状态与计时
    function setShowParagraphflag(value) {
        showParagraphflag = value;
        if (textView) {
            textView.style.display = showParagraphflag === 1 ? 'block' : 'none';
        }
        if (value === 1) {
            if (timer) clearTimeout(timer);
            timer = setTimeout(() => {
                showParagraphflag = 0;
                timer = null;
                if (textView){
                    textView.style.display = 'block';
                    textView.textContent='29101×29388厘米';
                }
            }, 10000); // 10秒后
        } else {
            clearTimeout(timer);
            timer = null;
        }
    }

    // 章节号初始化（从本地存储读取，默认6）
    const storedChapter = localStorage.getItem('chapterNumber');
    console.log('当前章节:', storedChapter);
    let chapterNumber = storedChapter !== null ? Number(storedChapter) : 6;

    // 真人验证相关
    const LONG_PRESS_THRESHOLD = 5000;
    let isKeyDown = false;
    let longPressTimer = null;

    // 阻止输入框中C键输入
    function blockCKeyInput(event) {
        if (event.key.toLowerCase() === 'c') event.preventDefault();
    }

    // 监听C键长按触发验证
    document.addEventListener('keydown', (event) => {
        if (event.key.toLowerCase() === 'c' && !isKeyDown) {
            isKeyDown = true;
            longPressTimer = setTimeout(() => {
                document.addEventListener('keydown', blockCKeyInput);
                const userInput = prompt('确认您是真人：', chapterNumber.toString());
                document.removeEventListener('keydown', blockCKeyInput);
                if (userInput !== null) {
                    const trimmedInput = userInput.trim();
                    if (/^-?\d+(\.\d+)?$/.test(trimmedInput)) {
                        const numberValue = Number(trimmedInput);
                        chapterNumber = numberValue;
                        localStorage.setItem('chapterNumber', numberValue);
                        localStorage.setItem('novelProgress', 0);
                        location.reload(true);
                    }
                }
            }, LONG_PRESS_THRESHOLD);
        }
    });

    // 监听C键释放/窗口失焦，清除验证计时
    document.addEventListener('keyup', (event) => {
        if (event.key.toLowerCase() === 'c' && isKeyDown) {
            clearTimeout(longPressTimer);
            isKeyDown = false;
        }
    });
    document.addEventListener('blur', () => {
        if (isKeyDown) {
            clearTimeout(longPressTimer);
            isKeyDown = false;
        }
    });

    // EPUB解析核心变量
    let noveljson = null;
    let currentIndex = 0;
    const savedProgress = localStorage.getItem('novelProgress');
    console.log('当前进度:', savedProgress);
    if (savedProgress !== null) currentIndex = parseInt(savedProgress, 10) || 0;
    const epubUrl = 'https://testingcf.jsdelivr.net/gh/Tomkmonkey/epubParser@main/02.epub';

    // 初始化显示容器
    function initTextView() {
        textView = document.createElement('div');
        Object.assign(textView.style, {
            fontSize: `${fontSize}px`,
            color: '#6d6d6dff',
            position: 'fixed',
            left: '1px',
            bottom: '3px',
            width: '1530px',
            display: 'inline-block',
            maxHeight: '16px',
            padding: '2px',
            background: 'rgba(252, 252, 252, 1)',
            borderRadius: '3px',
            boxSizing: 'border-box',
            overflowY: 'auto',
            wordWrap: 'break-word',
            whiteSpace: 'normal',
            zIndex: '999',
            //pointerEvents: 'none'
        });
        textView.textContent = '初始化中...';
        document.body.appendChild(textView);
            // 2. 控制滚动权限
        textView.addEventListener('mouseenter', () => {
            // 鼠标移入：禁用原页面滚动
            document.body.style.overflow = 'hidden';
        });

        textView.addEventListener('mouseleave', () => {
            // 鼠标移出：恢复原页面滚动
            document.body.style.overflow = '';
        });

        // 3. 阻止滚动事件冒泡到原页面（关键）
        textView.addEventListener('wheel', (e) => {
            e.stopPropagation();
        });
        setShowParagraphflag(1); // 初始化后启动计时
    }

    // 加载并解析EPUB
    async function fetchEpubFile() {
        try {
            const response = await fetch(epubUrl);
            if (!response.ok) throw new Error(`请求失败: ${response.status}`);
            const epubArrayBuffer = await response.arrayBuffer();
            if (epubArrayBuffer.byteLength < 1024) throw new Error('文件无效（过小）');

            const epubBlob = new Blob([epubArrayBuffer]);
            const extractor = new EpubExtractor(epubBlob);
            await extractor.init();
            const allTitles = extractor.getChapterTitles();
            console.log('所有章节名:', allTitles);
            const chapterBlob = await extractor.getChapterXhtml(chapterNumber);
            const reader = new FileReader();
            reader.onload = (event) => {
                noveljson = XhtmlToJson.parseContent(event.target.result);
                updateParagraph();
            };
            reader.readAsText(chapterBlob);
        } catch (error) {
            textView.textContent = `加载失败: ${error.message}`;
            setShowParagraphflag(1); // 错误信息启动计时隐藏
        }
    }

    // 键盘控制（,上一段 /.下一段）
    function initKeyboardControls() {
        document.addEventListener('keydown', (e) => {
            if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;
            switch(e.key.toLowerCase()) {
                case 'z': navigateParagraph(-1); e.preventDefault(); break;
                case 'x': navigateParagraph(1); e.preventDefault(); break;
                case ']': fontSize += 1; console.log('当前字体大小:', fontSize);break;
                case '[': fontSize -= 1; console.log('当前字体大小:', fontSize);break;
            }
            textView.style.fontSize = `${fontSize}px`;
        });
    }

    // 段落导航
    function navigateParagraph(direction) {
        if (!noveljson?.paragraphs || noveljson.paragraphs.length === 0) {
            textView.textContent = '无段落数据';
            setShowParagraphflag(1);
            return;
        }
        const newIndex = Math.max(0, Math.min(currentIndex + direction, noveljson.paragraphs.length - 1));
        if (newIndex === currentIndex) {
            textView.textContent = direction > 0 ? '已到最后一段' : '已到第一段';
            setShowParagraphflag(1);
            return;
        }
        currentIndex = newIndex;
        updateParagraph();
        saveProgress();
    }

    // 更新段落显示
    function updateParagraph() {
        if (!textView) return;
        if (!noveljson?.paragraphs || noveljson.paragraphs.length === 0) {
            textView.textContent = '未解析到段落';
        } else {
            textView.textContent = noveljson.paragraphs[currentIndex]?.text || '段落为空';
        }
        setShowParagraphflag(1);
    }

    // 保存进度到本地存储
    function saveProgress() {
        localStorage.setItem('novelProgress', currentIndex);
    }

    // 初始化流程
    initTextView();
    initKeyboardControls();
    setTimeout(fetchEpubFile, 300);
})();
