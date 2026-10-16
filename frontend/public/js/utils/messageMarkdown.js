/**
 * Sous-ensemble Markdown des réponses : aucun HTML ni URL du modèle n'est exécuté.
 */
function appendInline(parent, text) {
  const tokens = /(\*\*\*([^*\n]+)\*\*\*|\*\*([^*\n]+)\*\*|__([^_\n]+)__|`([^`\n]+)`|\*([^*\n]+)\*)/g;
  let offset = 0;
  for (const match of text.matchAll(tokens)) {
    parent.append(document.createTextNode(text.slice(offset, match.index)));
    const element = document.createElement(match[5] ? "code" : match[6] ? "em" : "strong");
    if (match[2]) {
      const emphasis = document.createElement("em");
      emphasis.textContent = match[2];
      element.append(emphasis);
    } else {
      element.textContent = match[3] || match[4] || match[5] || match[6];
    }
    parent.append(element);
    offset = match.index + match[0].length;
  }
  parent.append(document.createTextNode(text.slice(offset)));
}

export function renderMessageMarkdown(text) {
  const fragment = document.createDocumentFragment();
  let list = null;
  let codeBlock = null;
  for (const line of text.replace(/\r\n?/g, "\n").split("\n")) {
    if (/^\s*```/.test(line)) {
      list = null;
      if (codeBlock) codeBlock = null;
      else {
        const pre = document.createElement("pre");
        codeBlock = document.createElement("code");
        pre.append(codeBlock);
        fragment.append(pre);
      }
      continue;
    }
    if (codeBlock) {
      codeBlock.append(document.createTextNode(`${line}\n`));
      continue;
    }
    const trimmed = line.trim();
    if (!trimmed) {
      list = null;
      continue;
    }
    const item = trimmed.match(/^(?:([-*+])|(\d+)[.)])\s+(.+)$/);
    if (item) {
      const tag = item[2] ? "ol" : "ul";
      if (!list || list.localName !== tag) {
        list = document.createElement(tag);
        if (item[2]) list.start = Number(item[2]);
        fragment.append(list);
      }
      const li = document.createElement("li");
      appendInline(li, item[3]);
      list.append(li);
      continue;
    }
    list = null;
    const heading = trimmed.match(/^(#{1,6})\s+(.+)$/);
    const element = document.createElement(heading ? `h${Math.min(heading[1].length + 2, 6)}` : "p");
    appendInline(element, heading ? heading[2] : trimmed);
    fragment.append(element);
  }
  return fragment;
}
