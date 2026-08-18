import * as vscode from "vscode";

export interface SearchResult {
  name: string;
  path: string;
  dir: string;
  type: "file" | "folder";
  fsPath: string;
}

export interface SearchOptions {
  maxResults?: number;
  excludeFolders?: string[];
  includeHidden?: boolean;
}

const COMMON_EXCLUDE_FOLDERS = [
  "node_modules",
  ".git",
  "dist",
  "out",
  "build",
  ".cache",
];

/**
 * Parse the contents of a .gitignore file and return the list of
 * excluded folders.
 */
function parseGitignore(content: string): string[] {
  return content
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#")) // drop empty lines and comments
    .map((line) => {
      // strip leading and trailing slashes
      const pattern = line.replace(/^\/|\/$/g, "");
      // only keep directory patterns (those ending with / in gitignore are usually dirs)
      return pattern;
    })
    .filter((pattern) => {
      // Keep patterns that:
      // 1. Start with . (hidden directories like .vscode-test, .cache, .beads)
      // 2. End with / (explicitly directory patterns like build/)
      // 3. Don't contain dots (plain directory names like node_modules, dist)
      // Drop patterns with dots that don't start with . and don't end with /
      // (these are file patterns like *.log, README.md)
      return (
        pattern.startsWith(".") ||
        pattern.endsWith("/") ||
        !pattern.includes(".")
      );
    })
    .map((pattern) => pattern.replace(/\/$/, "")); // strip trailing slash
}

/**
 * Read the .gitignore file from the workspace root.
 */
async function getExcludeFolders(): Promise<string[]> {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders || workspaceFolders.length === 0) {
    return COMMON_EXCLUDE_FOLDERS;
  }

  try {
    const gitignoreUri = vscode.Uri.joinPath(
      workspaceFolders[0].uri,
      ".gitignore"
    );
    const content = await vscode.workspace.fs.readFile(gitignoreUri);
    const gitignoreContent = new TextDecoder().decode(content);
    const gitignoreFolders = parseGitignore(gitignoreContent);

    // union with the common exclude folders
    const combined = new Set([...COMMON_EXCLUDE_FOLDERS, ...gitignoreFolders]);

    return Array.from(combined);
  } catch {
    // fall back to the default exclude list if .gitignore is missing or unreadable
    return COMMON_EXCLUDE_FOLDERS;
  }
}

const DEFAULT_OPTIONS: Required<SearchOptions> = {
  maxResults: 20,
  excludeFolders: COMMON_EXCLUDE_FOLDERS,
  includeHidden: false,
};

/**
 * Recursively search files and folders in the workspace.
 * Uses the vscode.workspace.fs API for good cross-platform compatibility.
 *
 * Exclusion rules:
 * 1. Dynamically read from the project's .gitignore file.
 * 2. Union with common exclude folders (node_modules, .git, etc.).
 * 3. Fall back to the common exclude folders if no .gitignore exists.
 */
export async function searchWorkspaceFiles(
  query: string,
  options: SearchOptions = {}
): Promise<SearchResult[]> {
  // dynamically resolve the exclude folder list
  const excludeFolders = options.excludeFolders || (await getExcludeFolders());

  const maxResults = options.maxResults ?? DEFAULT_OPTIONS.maxResults;
  const includeHidden = options.includeHidden ?? DEFAULT_OPTIONS.includeHidden;

  const results: SearchResult[] = [];
  const workspaceFolders = vscode.workspace.workspaceFolders;

  if (!workspaceFolders || workspaceFolders.length === 0) {
    return [];
  }

  // iterate over all workspace folders
  for (const workspaceFolder of workspaceFolders) {
    if (results.length >= maxResults * 2) {
      // fetch a few extra results to improve sorting quality
      break;
    }

    await searchDirectory(
      workspaceFolder.uri,
      workspaceFolder.uri,
      query,
      results,
      {
        maxResults: maxResults * 2, // search more results to ensure sort quality
        excludeFolders,
        includeHidden,
      }
    );
  }

  // deduplicate
  const uniqueResults = results.filter(
    (result, index, self) =>
      index === self.findIndex((r) => r.path === result.path)
  );

  // sorting logic
  const normalizedQuery = query.replace(/\\/g, "/").toLowerCase();
  uniqueResults.sort((a, b) => {
    const aLowerName = a.name.toLowerCase();
    const bLowerName = b.name.toLowerCase();
    const aLowerPath = a.path.toLowerCase();
    const bLowerPath = b.path.toLowerCase();

    // 1. exact file/folder name match
    if (aLowerName === normalizedQuery && bLowerName !== normalizedQuery)
      return -1;
    if (bLowerName === normalizedQuery && aLowerName !== normalizedQuery)
      return 1;

    // 2. file name prefix match
    if (
      aLowerName.startsWith(normalizedQuery) &&
      !bLowerName.startsWith(normalizedQuery)
    )
      return -1;
    if (
      bLowerName.startsWith(normalizedQuery) &&
      !aLowerName.startsWith(normalizedQuery)
    )
      return 1;

    // 3. path substring match
    const aPathScore = aLowerPath.includes(normalizedQuery) ? 1 : 0;
    const bPathScore = bLowerPath.includes(normalizedQuery) ? 1 : 0;
    if (aPathScore !== bPathScore) return bPathScore - aPathScore;

    // 4. depth sort (shorter paths first)
    const aDepth = a.path.split("/").length;
    const bDepth = b.path.split("/").length;
    if (aDepth !== bDepth) return aDepth - bDepth;

    // 5. alphabetical order
    return a.path.localeCompare(b.path);
  });

  return uniqueResults.slice(0, maxResults);
}

/**
 * Recursively search a directory.
 */
async function searchDirectory(
  dirUri: vscode.Uri,
  workspaceRootUri: vscode.Uri,
  query: string,
  results: SearchResult[],
  options: Required<SearchOptions>
): Promise<void> {
  if (results.length >= options.maxResults) {
    return;
  }

  try {
    const entries = await vscode.workspace.fs.readDirectory(dirUri);

    for (const [name, type] of entries) {
      if (results.length >= options.maxResults) {
        return;
      }

      // .git is always hidden; other hidden files/folders are skipped
      // only when includeHidden is disabled
      if (name === ".git" || (!options.includeHidden && name.startsWith("."))) {
        continue;
      }

      // skip excluded directories entirely (don't add to results or recurse)
      if (
        type === vscode.FileType.Directory &&
        options.excludeFolders.includes(name)
      ) {
        continue;
      }

      const uri = vscode.Uri.joinPath(dirUri, name);
      // compute the relative path manually to ensure consistency
      const rootPath = workspaceRootUri.fsPath;
      const entryPath = uri.fsPath;
      let relativePath = entryPath.startsWith(rootPath)
        ? entryPath.slice(rootPath.length)
        : entryPath;

      // strip leading slashes and normalize to forward slashes
      relativePath = relativePath.replace(/^[/\\]+/, "").replace(/\\/g, "/");

      // check whether the entry matches the query (empty query matches all)
      let isMatch = false;
      if (!query) {
        isMatch = true;
      } else {
        const normalizedQuery = query.replace(/\\/g, "/").toLowerCase();
        const lowerName = name.toLowerCase();
        const lowerRelativePath = relativePath.toLowerCase();

        if (normalizedQuery.includes("/")) {
          // if the query contains a path separator, match against the relative path
          isMatch = lowerRelativePath.includes(normalizedQuery);
        } else {
          // otherwise match only the file/folder name
          isMatch = lowerName.includes(normalizedQuery);
        }
      }

      if (isMatch) {
        const pathParts = relativePath.split("/");
        const dirPath = pathParts.slice(0, -1).join("/");

        if (type === vscode.FileType.Directory) {
          results.push({
            name,
            path: relativePath,
            dir: dirPath || "",
            type: "folder",
            fsPath: uri.fsPath,
          });
        } else if (type === vscode.FileType.File) {
          results.push({
            name,
            path: relativePath,
            dir: dirPath || "",
            type: "file",
            fsPath: uri.fsPath,
          });
        }
      }

      // recurse into subdirectories (excluded dirs already skipped above)
      if (type === vscode.FileType.Directory) {
        const subDirUri = vscode.Uri.joinPath(dirUri, name);
        await searchDirectory(
          subDirUri,
          workspaceRootUri,
          query,
          results,
          options
        );
      }
    }
  } catch {
    // ignore permission errors or inaccessible directories
  }
}
