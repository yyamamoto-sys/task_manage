import { useAppStore } from "../../stores/appStore";
import type { Member } from "../../lib/localData/types";
import { canAccessAdminSection, settingsHelpModeKey } from "../../lib/settings/settingsSections";
import { HelpButton } from "../guide/HelpButton";

/** 設定ページ見出しの「？」。「部署の管理」を見られる人（SettingsView と同じ判定）には管理向け、それ以外には個人設定向けの記事を開く */
export function SettingsHelpButton({ currentUser, title }: { currentUser: Member; title: string }) {
  const members = useAppStore(s => s.members);
  const showAdmin = canAccessAdminSection(currentUser, members);
  return <HelpButton modeKey={settingsHelpModeKey(showAdmin)} title={title} />;
}
