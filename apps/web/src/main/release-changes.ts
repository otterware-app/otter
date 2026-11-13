import { useQuery } from "@tanstack/react-query";

const REPO = "otterware-app/otter";

// Areas this app doesn't ship: the iPhone apps, docs and CI (the `pr` skill's title prefixes).
const ELSEWHERE =
  /^(?:iPhone[^:]*|Otter Agents|AGENTS\.md|Docs|Changelog|CI|Releases?|\w+\((?:ios|mobile)\)):/i;

export type ReleaseChanges = {
  titles: string[];
  /** GitHub sends the newest 250 commits of a range; older changes are only on the compare page. */
  more: boolean;
};

export function releaseCompareUrl(from: string, to: string): string {
  return `https://github.com/${REPO}/compare/v${from}...v${to}`;
}

/** The titles of the pull requests merged in a range, newest first, from their merge commits. */
export function pullRequestTitles(messages: string[]): string[] {
  return messages
    .flatMap((message) => {
      if (!message.startsWith("Merge pull request #")) return [];
      const title = message
        .split("\n\n")[1]
        ?.split("\n")[0]
        ?.trim()
        .replace(/\s*\((?:Fixes|lands)\b[^)]*\)$/i, "");
      return title && !ELSEWHERE.test(title) ? [title] : [];
    })
    .toReversed();
}

async function fetchReleaseChanges(from: string, to: string): Promise<ReleaseChanges> {
  const response = await fetch(`https://api.github.com/repos/${REPO}/compare/v${from}...v${to}`, {
    headers: { Accept: "application/vnd.github+json" },
  });
  if (!response.ok) throw new Error(`GitHub answered ${response.status}`);
  const { total_commits, commits } = (await response.json()) as {
    total_commits: number;
    commits: { commit: { message: string } }[];
  };
  return {
    titles: pullRequestTitles(commits.map((c) => c.commit.message)),
    more: total_commits > commits.length,
  };
}

/** What changed between the installed version and an update, as the merged pull requests. */
export function useReleaseChanges(from: string, to: string | null) {
  return useQuery({
    queryKey: ["release-changes", from, to],
    queryFn: () => fetchReleaseChanges(from, to!),
    enabled: to !== null,
    staleTime: Infinity,
    retry: false,
  }).data;
}
