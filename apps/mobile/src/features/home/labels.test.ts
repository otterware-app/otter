import type { MailLabel } from "@otter-mail/client-runtime/mail";
import { describe, expect, it } from "vite-plus/test";

import { bulkTagVerb, labelChoices, moveToFolder } from "./labels";

const label = (id: string, name = id, type: MailLabel["type"] = "user"): MailLabel => ({
  id,
  name,
  type,
});

describe("labelChoices", () => {
  const labels = [label("INBOX", "Inbox", "system"), label("Work"), label("folder:Receipts")];

  it("toggles Gmail's labels", () => {
    const gmail = labelChoices(labels, { multipleLabels: true } as never);
    expect(gmail.tags.map((l) => l.id)).toEqual(["Work", "folder:Receipts"]);
    expect(gmail.folders).toEqual([]);
    expect(gmail.tagsTitle).toBe("Labels");
  });

  it("toggles Outlook's categories and moves into its folders", () => {
    const outlook = labelChoices(labels, {
      multipleLabels: true,
      foldersAndCategories: true,
    } as never);
    expect(outlook.tags.map((l) => l.id)).toEqual(["Work"]);
    expect(outlook.folders.map((l) => l.id)).toEqual(["folder:Receipts"]);
    expect(outlook.tagsTitle).toBe("Categories");
  });

  it("moves IMAP mail into its folders", () => {
    const imap = labelChoices(labels, { multipleLabels: false } as never);
    expect(imap.tags).toEqual([]);
    expect(imap.folders.map((l) => l.id)).toEqual(["Work", "folder:Receipts"]);
  });
});

describe("moveToFolder", () => {
  it("leaves every other folder, keeping flags", () => {
    expect(moveToFolder(["INBOX", "UNREAD", "Old"], "New", [label("Old"), label("New")])).toEqual({
      addLabelIds: ["New"],
      removeLabelIds: ["INBOX", "Old"],
    });
  });
});

describe("bulkTagVerb", () => {
  it("removes when every one has it, else adds", () => {
    expect(bulkTagVerb([true, true])).toBe("Remove");
    expect(bulkTagVerb([true, false])).toBe("Add");
    expect(bulkTagVerb([])).toBe("Add");
  });
});
