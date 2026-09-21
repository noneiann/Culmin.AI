/** Render source links without allowing email HTML or executable URL schemes. */
export default function MessageText({ text }: { text: string }) {
  return text.split(/(\[[^\]]+\]\(https?:\/\/[^\s)]+\)|https?:\/\/[^\s]+)/g).map((part, index) => {
    const markdown = part.match(/^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)$/);
    const href = markdown?.[2] ?? (/^https?:\/\//.test(part) ? part : null);
    return href ? (
      <a className="message-link" key={index} href={href} target="_blank" rel="noreferrer">
        {markdown?.[1] ?? part}
      </a>
    ) : (
      part
    );
  });
}
