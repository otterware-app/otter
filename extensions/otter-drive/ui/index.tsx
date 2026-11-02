import type { UiExtension } from "@otter-mail/web/extension-kit";
import { FolderOpenIcon, HardDriveUploadIcon } from "lucide-react";

import { manifest } from "../manifest";
import { driveApi } from "./api";
import { OtterDriveDialogs, browseOtterDrive, saveToOtterDrive } from "./dialogs";
import { OtterDriveIcon } from "./icon";
import { OtterDriveSettingsPane } from "./settings";

export default {
  manifest,
  Icon: OtterDriveIcon,
  messageActions: [
    {
      id: "otter-drive:save",
      label: "Save to Otter Drive",
      menuLabel: "Save to Otter Drive…",
      Icon: HardDriveUploadIcon,
      run: saveToOtterDrive,
    },
  ],
  commands: [
    {
      id: "otter-drive",
      title: "Browse Otter Drive",
      keywords: "drive artifacts files documents",
      Icon: FolderOpenIcon,
      run: browseOtterDrive,
    },
  ],
  Dialogs: OtterDriveDialogs,
  Settings: OtterDriveSettingsPane,
  connection: {
    provides: "Files",
    status: { queryKey: ["otter-drive", "status"], queryFn: driveApi.status },
  },
} satisfies UiExtension;
