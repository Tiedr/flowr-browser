// Quiet Reader — injected into the active tab by popup.js.
//
// Built as a popup-driven extension rather than a background service worker
// because Electron does not run MV3 service workers: the original
// `background.service_worker` + `chrome.action.onClicked` shape silently
// never fired, so the extension installed but did nothing.
//
// The reader clones the article into a fixed overlay and leaves the page's own
// DOM untouched, so closing it is always instant and lossless.
(function () {
  const ID = 'flowr-quiet-reader';
  const STYLE_ID = 'flowr-quiet-reader-style';

  if (document.getElementById(ID)) {
    document.getElementById(ID).remove();
    const stale = document.getElementById(STYLE_ID);
    if (stale) stale.remove();
    return 'closed';
  }

  const source = document.querySelector('article, main, [role="main"]') || document.body;
  const box = document.createElement('section');
  box.id = ID;
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-label', 'Quiet Reader');

  const close = document.createElement('button');
  close.setAttribute('aria-label', 'Close reading mode');
  close.textContent = '×';

  const content = document.createElement('div');
  // innerHTML on a *clone* of the page's own article — the same content the
  // page already rendered, not new markup from anywhere else.
  content.innerHTML = source.cloneNode(true).innerHTML;
  content.querySelectorAll('nav,aside,footer,script,style,noscript,form,button,input,select,textarea,iframe').forEach(el => el.remove());

  box.append(close, content);

  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    #${ID}{position:fixed;inset:0;z-index:2147483647;overflow:auto;background:#f3efe6;color:#24221f;padding:72px 24px 96px;font:19px/1.8 Georgia,Cambria,"Times New Roman",serif}
    #${ID}>div{max-width:760px;margin:0 auto}
    #${ID} img,#${ID} video{max-width:100%;height:auto;border-radius:12px;display:block;margin:26px auto}
    #${ID} h1,#${ID} h2,#${ID} h3{font:650 30px/1.25 -apple-system,"Segoe UI",system-ui,sans-serif;letter-spacing:-.5px;margin:0 0 14px}
    #${ID} a{color:#2963d6;text-decoration:none}
    #${ID} button{position:fixed;right:26px;top:22px;border:1px solid #d9d2c4;background:#24221f;color:#fff;width:42px;height:42px;border-radius:50%;font-size:24px;line-height:1;cursor:pointer}
    #${ID} nav,#${ID} aside,#${ID} footer,#${ID} form{display:none!important}
  `;

  document.head.appendChild(style);
  document.body.appendChild(box);
  close.onclick = () => { box.remove(); style.remove(); };
  return 'opened';
})();