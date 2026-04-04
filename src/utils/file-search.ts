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
 * 解析 .gitignore 文件内容，返回排除的文件夹列表
 */
function parseGitignore(content: string): string[] {
  return content
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#")) // 过滤空行和注释
    .map((line) => {
      // 移除开头和结尾的 /
      const pattern = line.replace(/^\/|\/$/g, "");
      // 只返回目录模式（以 / 结尾的在 gitignore 中通常是目录）
      return pattern;
    })
    .filter((pattern) => {
      // 过滤掉纯文件模式，只保留可能是目录的模式
      // 如果包含 / 或者没有扩展名，可能是目录
      return !pattern.includes(".") || pattern.endsWith("/");
    })
    .map((pattern) => pattern.replace(/\/$/, "")); // 移除结尾的 /
}

/**
 * 从工作区根目录读取 .gitignore 文件
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

    // 与常见排除目录做并集
    const combined = new Set([...COMMON_EXCLUDE_FOLDERS, ...gitignoreFolders]);

    return Array.from(combined);
  } catch (error) {
    // 如果没有 .gitignore 文件或者读取失败，使用默认排除列表
    console.debug("读取 .gitignore 失败，使用默认排除列表", error);
    return COMMON_EXCLUDE_FOLDERS;
  }
}

const DEFAULT_OPTIONS: Required<SearchOptions> = {
  maxResults: 20,
  excludeFolders: COMMON_EXCLUDE_FOLDERS,
  includeHidden: false,
};

/**
 * 递归搜索工作区中的文件和文件夹
 * 使用 vscode.workspace.fs API 以保持良好的跨平台兼容性
 *
 * 排除规则：
 * 1. 从项目 .gitignore 文件动态读取
 * 2. 与常见排除目录（node_modules, .git 等）做并集
 * 3. 如果没有 .gitignore，使用默认的常见排除目录
 */
export async function searchWorkspaceFiles(
  query: string,
  options: SearchOptions = {}
): Promise<SearchResult[]> {
  // 动态获取排除文件夹列表
  const excludeFolders = options.excludeFolders || (await getExcludeFolders());

  const maxResults = options.maxResults ?? DEFAULT_OPTIONS.maxResults;
  const includeHidden = options.includeHidden ?? DEFAULT_OPTIONS.includeHidden;

  const results: SearchResult[] = [];
  const workspaceFolders = vscode.workspace.workspaceFolders;

  if (!workspaceFolders || workspaceFolders.length === 0) {
    return [];
  }

  // 遍历所有工作区文件夹
  for (const workspaceFolder of workspaceFolders) {
    if (results.length >= maxResults) {
      break;
    }

    await searchDirectory(
      workspaceFolder.uri,
      workspaceFolder.uri,
      query,
      results,
      {
        maxResults,
        excludeFolders,
        includeHidden,
      }
    );
  }

  // 去重并限制结果数量
  const uniqueResults = results.filter(
    (result, index, self) =>
      index === self.findIndex((r) => r.path === result.path)
  );

  return uniqueResults.slice(0, maxResults);
}

/**
 * 递归搜索目录
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

      // 跳过隐藏文件/文件夹（除非配置包含）
      if (!options.includeHidden && name.startsWith(".")) {
        continue;
      }

      // 检查是否匹配查询（空查询匹配所有）
      const isMatch =
        !query || name.toLowerCase().includes(query.toLowerCase());

      if (isMatch) {
        const uri = vscode.Uri.joinPath(dirUri, name);
        const relativePath = vscode.workspace.asRelativePath(uri);
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

      // 如果是文件夹且不在排除列表中，递归搜索
      if (
        type === vscode.FileType.Directory &&
        !options.excludeFolders.includes(name)
      ) {
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
  } catch (error) {
    // 忽略权限错误或无法访问的目录
    if (error instanceof vscode.FileSystemError) {
      console.debug(`无法访问目录: ${dirUri.fsPath}`, error);
    }
  }
}
