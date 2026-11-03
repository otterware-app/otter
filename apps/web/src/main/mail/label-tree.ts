import type { MailLabel } from "./types";

export type LabelTreeNode = {
  key: string;
  segment: string;
  label?: MailLabel;
  children: LabelTreeNode[];
};

// Gmail nests user labels by "/" in the name (e.g. "99/personal" is a child of "99").
export const PENDING_LABEL_PREFIX = "pending:";

export function isAssignableLabel(label: MailLabel): boolean {
  return label.type === "user" && !label.id.startsWith(PENDING_LABEL_PREFIX);
}

export function buildLabelTree(labels: MailLabel[]): LabelTreeNode[] {
  const root: LabelTreeNode[] = [];
  const nodesByPath = new Map<string, LabelTreeNode>();

  for (const label of labels) {
    const parts = label.name.split("/").filter(Boolean);
    let siblings = root;
    let path = "";
    parts.forEach((part, i) => {
      path = path ? `${path}/${part}` : part;
      let node = nodesByPath.get(path);
      if (!node) {
        node = { key: path, segment: part, children: [] };
        nodesByPath.set(path, node);
        siblings.push(node);
      }
      if (i === parts.length - 1) node.label = label;
      siblings = node.children;
    });
  }

  sortLabelTree(root);
  return root;
}

export function sortLabelTree(nodes: LabelTreeNode[]): void {
  nodes.sort((a, b) => a.segment.localeCompare(b.segment));
  for (const node of nodes) sortLabelTree(node.children);
}

export function flattenLabelTree(
  nodes: LabelTreeNode[],
  depth = 0,
): { node: LabelTreeNode; depth: number }[] {
  const result: { node: LabelTreeNode; depth: number }[] = [];
  for (const node of nodes) {
    result.push({ node, depth });
    result.push(...flattenLabelTree(node.children, depth + 1));
  }
  return result;
}
