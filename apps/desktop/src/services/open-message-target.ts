export type OpenMessageTarget = { accountId: string; messageId: string };

let pending: OpenMessageTarget | null = null;

export function setPendingOpenMessage(target: OpenMessageTarget): void {
  pending = target;
}

export function takePendingOpenMessage(): OpenMessageTarget | null {
  const target = pending;
  pending = null;
  return target;
}
