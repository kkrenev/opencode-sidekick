import { escapeHtml } from './format';

export function renderMarkdown(source: string): string {
  const codeBlocks: { lang: string; body: string }[] = [];
  let text = source.replace(/```([\w+#.-]*)\n?([\s\S]*?)```/g, (_match, lang, body) => {
    const index = codeBlocks.length;
    codeBlocks.push({ lang: lang || 'text', body: body.replace(/\n$/, '') });
    return `\u0000CODE${index}\u0000`;
  });

  text = escapeHtml(text);

  const lines = text.split('\n');
  const out: string[] = [];
  let list: 'ul' | 'ol' | null = null;

  const closeList = () => {
    if (list) {
      out.push(`</${list}>`);
      list = null;
    }
  };

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    const placeholder = line.match(/^\u0000CODE(\d+)\u0000$/);
    if (placeholder) {
      closeList();
      const block = codeBlocks[Number(placeholder[1])];
      out.push(codeBlockHtml(block.lang, block.body));
      continue;
    }
    if (line.trim().length === 0) {
      closeList();
      continue;
    }
    const heading = line.match(/^(#{1,3})\s+(.*)$/);
    if (heading) {
      closeList();
      const level = heading[1].length;
      out.push(`<h${level}>${inline(heading[2])}</h${level}>`);
      continue;
    }
    const bullet = line.match(/^\s*[-*]\s+(.*)$/);
    if (bullet) {
      if (list !== 'ul') {
        closeList();
        out.push('<ul>');
        list = 'ul';
      }
      out.push(`<li>${inline(bullet[1])}</li>`);
      continue;
    }
    const ordered = line.match(/^\s*(\d+)\.\s+(.*)$/);
    if (ordered) {
      if (list !== 'ol') {
        closeList();
        out.push('<ol>');
        list = 'ol';
      }
      out.push(`<li>${inline(ordered[2])}</li>`);
      continue;
    }
    const quote = line.match(/^>\s?(.*)$/);
    if (quote) {
      closeList();
      out.push(`<blockquote>${inline(quote[1])}</blockquote>`);
      continue;
    }
    closeList();
    out.push(`<p>${inline(line)}</p>`);
  }
  closeList();

  return out.join('');
}

function inline(text: string): string {
  return text
    .replace(/`([^`]+)`/g, (_m, code) => `<code>${code}</code>`)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[\s(])\*([^*\n]+)\*/g, '$1<em>$2</em>')
    .replace(/~~([^~]+)~~/g, '<s>$1</s>')
    .replace(
      /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
      '<a href="#" data-act="external" data-url="$2">$1</a>',
    );
}

function codeBlockHtml(lang: string, body: string): string {
  return `<div class="code"><div class="code-head"><span class="code-lang">${escapeHtml(lang)}</span><button class="copy-btn" data-act="copy" data-text="${escapeHtml(body)}">Copy</button></div><pre><code>${escapeHtml(body)}</code></pre></div>`;
}
