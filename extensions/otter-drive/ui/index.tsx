import type { UiExtension } from "@otter-mail/web/extension-kit";
import { HardDriveUploadIcon } from "lucide-react";

import { manifest } from "../manifest";
import { driveApi } from "./api";
import { OtterDriveDialogs, saveToOtterDrive } from "./dialogs";
import { DriveGlyph } from "./glyph";
import { OtterDriveIcon } from "./icon";
import { paletteSearch } from "./search";
import { OtterDriveSettingsPane } from "./settings";
import { DriveMain, DriveSidebar, MINE } from "./workspace";

export default {
  manifest,
  Icon: OtterDriveIcon,
  workspaces: [
    { id: "drive", Icon: DriveGlyph, home: MINE, Sidebar: DriveSidebar, Main: DriveMain },
  ],
  messageActions: [
    {
      id: "otter-drive:save",
      label: "Save to Otter Drive",
      menuLabel: "Save to Otter Drive…",
      Icon: HardDriveUploadIcon,
      run: saveToOtterDrive,
    },
  ],
  Dialogs: OtterDriveDialogs,
  paletteSearch,
  Settings: OtterDriveSettingsPane,
  connection: {
    provides: "Files",
    status: { queryKey: ["otter-drive", "status"], queryFn: driveApi.status },
  },
} satisfies UiExtension;
