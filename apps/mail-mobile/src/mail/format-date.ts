import { native } from "@otter/mobile/native";

export const shortMailDate = (timestamp: number) => native.shortMailDate(timestamp);

export const fullMailDate = (timestamp: number) => native.formatMailDate(timestamp);
