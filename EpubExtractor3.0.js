class EpubExtractor {
  static C = {
    N: 'http://www.daisy.org/z3986/2005/ncx/',
    B: 'application/xhtml+xml',
    D: '章节',
    O: ['OEBPS/content.opf', 'content.opf', 'EPUB/content.opf'],
    M: 'META-INF/container.xml',
    T: ['h1', 'h2', '[class*="title"]', '[class*="Title"]', 'h3'],
    L: 2
  };

  constructor(f) {
    if (!f) throw new Error('请提供EPUB文件');
    this.f = f; this.z = null; this.o = null; this.n = null; this.c = []; this.i = false; this.j = null;
  }

  async init() {
    if (this.i) return;
    try {
      const J = await this.l();
      this.z = await J.loadAsync(await this.r(this.f));
      this.o = await this.fO();
      if (!this.o) throw new Error('无content.opf，非有效EPUB');
      await this.p(); await this.t(); this.i = true;
    } catch (e) { console.error('初始化失败:', e); throw e; }
  }

  async l() {
    if (window.JSZip) return window.JSZip;
    if (!this.j) this.j = new Promise((r, j) => {
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js';
      s.onload = () => r(window.JSZip);
      s.onerror = () => j(new Error('JSZip加载失败'));
      document.head.appendChild(s);
    });
    return this.j;
  }

  r(f) {
    return new Promise((r, j) => {
      const d = new FileReader();
      d.onload = e => r(e.target.result);
      d.onerror = j; d.readAsArrayBuffer(f);
    });
  }

  async fO() {
    const { M, O } = EpubExtractor.C;
    const c = this.z.file(M);
    if (c) {
      const x = new DOMParser().parseFromString(await c.async('text'), 'text/xml');
      const r = x.querySelector('rootfile');
      if (r) return r.getAttribute('full-path');
    }
    return O.find(p => this.z.file(p)) || null;
  }

  async p() {
    const { N, D } = EpubExtractor.C;
    const f = this.z.file(this.o);
    if (!f) throw new Error(`无content.opf: ${this.o}`);
    const x = new DOMParser().parseFromString(await f.async('text'), 'text/xml');
    const d = this.o.lastIndexOf('/') > -1 ? this.o.slice(0, this.o.lastIndexOf('/') + 1) : '';
    
    const ni = x.querySelector('item[id="ncx"]');
    if (ni) this.n = this.s(d, ni.getAttribute('href'));

    this.c = Array.from(x.querySelectorAll('spine itemref')).map((i, idx) => {
      const ir = i.getAttribute('idref');
      const mi = x.querySelector(`item[id="${ir}"]`);
      if (!mi) return null;
      const h = mi.getAttribute('href');
      return { id: ir, p: this.s(d, h), s: h, t: `${D}${idx + 1}` };
    }).filter(Boolean);

    if (!this.n) return;
    const nf = this.z.file(this.n);
    if (!nf) return console.warn(`无NCX: ${this.n}`);

    try {
      const nx = new DOMParser().parseFromString(await nf.async('text'), 'text/xml');
      const m = {};
      const np = document.evaluate('//ncx:navMap/ncx:navPoint', nx, p => p === 'ncx' ? N : null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE);
      
      for (let i = 0; i < np.snapshotLength; i++) {
        const p = np.snapshotItem(i);
        const tn = document.evaluate('./ncx:navLabel/ncx:text', p, p => p === 'ncx' ? N : null, XPathResult.FIRST_ORDERED_NODE_TYPE).singleNodeValue;
        const sn = document.evaluate('./ncx:content', p, p => p === 'ncx' ? N : null, XPathResult.FIRST_ORDERED_NODE_TYPE).singleNodeValue;
        if (tn && sn) {
          const t = tn.textContent.replace(/\s+/g, ' ').trim();
          const s = sn.getAttribute('src');
          if (t) m[s] = t;
        }
      }

      this.c.forEach(ch => ch.t = m[ch.s] || ch.t);
      console.log(`NCX匹配${Object.keys(m).length}个标题`);
    } catch (e) { console.warn('NCX解析失败，将从XHTML提取:', e); }
  }

  async t() {
    const { D, T, L } = EpubExtractor.C;
    await Promise.all(this.c.map(async (ch, idx) => {
      if (ch.t !== `${D}${idx + 1}`) return;
      try {
        const x = await this.z.file(ch.p).async('text');
        const d = new DOMParser().parseFromString(x, 'text/html');
        for (const s of T) {
          const e = d.querySelector(s);
          if (e) {
            const t = e.textContent.replace(/\s+/g, ' ').trim();
            if (t.length >= L) { ch.t = t; break; }
          }
        }
      } catch (e) { console.warn(`解析章节${idx + 1}标题失败:`, e); }
    }));
  }

  s(b, r) {
    if (r.startsWith('/')) return r.slice(1);
    const bp = b.split('/').filter(Boolean);
    r.split('/').filter(Boolean).forEach(p => p === '..' && bp.length ? bp.pop() : bp.push(p));
    return bp.join('/');
  }

  // 对外API
  getChapterTitles() {
    if (!this.i) throw new Error('请先init()');
    return this.c.map(ch => ch.t);
  }

  getChapterTitle(i) {
    if (!this.i) throw new Error('请先init()');
    if (i < 0 || i >= this.c.length) throw new Error(`索引无效，范围0-${this.c.length - 1}`);
    return this.c[i].t;
  }

  async getChapterXhtml(i) {
    if (!this.i) throw new Error('请先init()');
    if (i < 0 || i >= this.c.length) throw new Error(`索引无效，范围0-${this.c.length - 1}`);
    const ch = this.c[i];
    const f = this.z.file(ch.p);
    if (!f) throw new Error(`无章节文件: ${ch.p}`);
    return new Blob([await f.async('arraybuffer')], { type: EpubExtractor.C.B });
  }
}
