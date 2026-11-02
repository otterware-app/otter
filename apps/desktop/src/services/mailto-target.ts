export type MailtoTarget = {
  to: string;
  cc: string;
  subject: string;
  body: string;
};

let pending: MailtoTarget | null = null;

export function setPendingMailto(target: MailtoTarget): void {
  pending = target;
}

export function takePendingMailto(): MailtoTarget | null {
  const t = pending;
  pending = null;
  return t;
}

/**
 * RFC 6068 mailto parser. Query values are percent-decoded manually — "+" is
 * a literal plus in mailto URLs, so URLSearchParams' form-decoding would
 * corrupt addresses.
 */
export function parseMailtoUrl(raw: string): MailtoTarget | null {
  if (!/^mailto:/i.test(raw)) return null;
  const rest = raw.slice("mailto:".length);
  const qIdx = rest.indexOf("?");
  const decode = (s: string): string => {
    try {
      return decodeURIComponent(s);
    } catch {
      return s;
    }
  };
  const target: MailtoTarget = {
    to: decode(qIdx === -1 ? rest : rest.slice(0, qIdx)),
    cc: "",
    subject: "",
    body: "",
  };
  if (qIdx !== -1) {
    for (const pair of rest.slice(qIdx + 1).split("&")) {
      const eq = pair.indexOf("=");
      if (eq === -1) continue;
      const key = decode(pair.slice(0, eq)).toLowerCase();
      const value = decode(pair.slice(eq + 1));
      if (key === "to") target.to = target.to ? `${target.to}, ${value}` : value;
      else if (key === "cc") target.cc = value;
      else if (key === "subject") target.subject = value;
      else if (key === "body") target.body = value;
    }
  }
  return target;
}
