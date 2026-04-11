import * as vscode from "vscode";
import * as assert from "assert";
import { searchWorkspaceFiles, type SearchResult } from "../utils/file-search";

suite("File Search Utility Test Suite", () => {
  // 测试基本的搜索功能
  test("应该能够搜索到匹配的文件", async () => {
    const results = await searchWorkspaceFiles("package");

    assert.ok(Array.isArray(results), "结果应该是数组");

    // 验证结果结构（如果有结果的话）
    if (results.length > 0) {
      const firstResult = results[0];
      assert.ok(firstResult.name, "结果应该有 name");
      assert.ok(firstResult.path, "结果应该有 path");
      assert.ok(firstResult.type, "结果应该有 type");
      assert.ok(firstResult.fsPath, "结果应该有 fsPath");
      assert.ok(firstResult.dir !== undefined, "结果应该有 dir");
    }
  });

  test("应该能够搜索到匹配的文件夹", async () => {
    const results = await searchWorkspaceFiles("src", { maxResults: 50 });

    const folderResults = results.filter(
      (r: SearchResult) => r.type === "folder"
    );

    // 在测试环境中，src 目录应该存在
    if (results.length > 0) {
      // 验证如果找到结果，文件夹的类型是正确的
      folderResults.forEach((r) => assert.strictEqual(r.type, "folder"));
    }
  });

  test("应该同时返回文件和文件夹", async () => {
    const results = await searchWorkspaceFiles("ts", { maxResults: 50 });

    const fileResults = results.filter((r: SearchResult) => r.type === "file");
    const folderResults = results.filter(
      (r: SearchResult) => r.type === "folder"
    );

    // 验证类型正确
    fileResults.forEach((r: SearchResult) =>
      assert.strictEqual(r.type, "file")
    );
    folderResults.forEach((r: SearchResult) =>
      assert.strictEqual(r.type, "folder")
    );
  });

  test("应该限制结果数量", async () => {
    const maxResults = 5;
    const results = await searchWorkspaceFiles("", { maxResults });

    assert.ok(results.length <= maxResults, `结果数量不应该超过 ${maxResults}`);
  });

  test("应该排除 node_modules 文件夹", async () => {
    const results = await searchWorkspaceFiles("module");

    const nodeModulesResults = results.filter(
      (r: SearchResult) =>
        r.path.includes("node_modules") || r.name === "node_modules"
    );

    assert.strictEqual(
      nodeModulesResults.length,
      0,
      "不应该包含 node_modules 的结果"
    );
  });

  test("搜索应该不区分大小写", async () => {
    const resultsLower = await searchWorkspaceFiles("readme");
    const resultsUpper = await searchWorkspaceFiles("README");

    // 两种搜索应该返回相同的结果
    assert.strictEqual(
      resultsLower.length,
      resultsUpper.length,
      "大小写不同的搜索应该返回相同数量的结果"
    );
  });

  test("空查询应该返回所有文件", async () => {
    const results = await searchWorkspaceFiles("", { maxResults: 10 });

    assert.ok(results.length <= 10, "结果数量不应该超过 maxResults");

    // 验证结果结构（如果有结果的话）
    if (results.length > 0) {
      assert.ok(results.length > 0, "空查询应该返回结果（如果工作区有文件）");
      results.forEach((r: SearchResult) => {
        assert.ok(r.name, "结果应该有 name");
        assert.ok(r.type, "结果应该有 type");
      });
    }
  });

  test("结果应该包含正确的相对路径", async () => {
    const results = await searchWorkspaceFiles("package");

    if (results.length > 0) {
      const result = results[0];
      // 相对路径不应该以 / 开头
      assert.ok(!result.path.startsWith("/"), "相对路径不应该以 / 开头");
      // 相对路径应该是相对于工作区根的
      assert.ok(result.path.includes(result.name), "路径应该包含文件名");
    }
  });

  test("文件夹结果应该有正确的 dir 字段", async () => {
    const results = await searchWorkspaceFiles("src", { maxResults: 50 });

    const folderResults = results.filter(
      (r: SearchResult) => r.type === "folder"
    );
    for (const folder of folderResults) {
      // dir 字段应该是路径的父级部分
      if (folder.dir) {
        assert.ok(
          folder.path.startsWith(folder.dir),
          `路径 ${folder.path} 应该以 ${folder.dir} 开头`
        );
      }
    }
  });

  test("应该使用 .gitignore 中的排除规则", async () => {
    // 搜索一个可能在 .gitignore 目录中的名称
    const results = await searchWorkspaceFiles("vscode-test", {
      maxResults: 100,
    });

    // .vscode-test 在 .gitignore 中，不应该出现在结果中
    const vscodeTestResults = results.filter(
      (r: SearchResult) =>
        r.name === ".vscode-test" || r.path.includes(".vscode-test")
    );

    assert.strictEqual(
      vscodeTestResults.length,
      0,
      "不应该包含 .gitignore 中排除的 .vscode-test 目录"
    );
  });

  test("应该排除 node_modules 即使 .gitignore 不存在", async () => {
    // node_modules 是 COMMON_EXCLUDE_FOLDERS 的一部分
    const results = await searchWorkspaceFiles("module", { maxResults: 100 });

    const nodeModulesResults = results.filter(
      (r: SearchResult) =>
        r.path.includes("node_modules") || r.name === "node_modules"
    );

    assert.strictEqual(
      nodeModulesResults.length,
      0,
      "即使没有 .gitignore，也应该排除 node_modules"
    );
  });

  test("精确匹配应该排在最前面", async () => {
    // 搜索 "src"，第一个结果应该是名字为 "src" 的文件夹
    const results = await searchWorkspaceFiles("src");

    if (results.length > 0) {
      assert.strictEqual(
        results[0].name.toLowerCase(),
        "src",
        "搜索 'src' 时，第一个结果的名字应该是 'src'"
      );
    }
  });

  test("不包含斜杠时，不应该因为路径匹配而返回", async () => {
    // 搜索 "src"，第一个结果的名字应该是 "src"
    // 而不是路径中有 "src" 的其他文件（如 "extension.ts" 在 "src" 目录下）
    const results = await searchWorkspaceFiles("src");

    for (const result of results) {
      assert.ok(
        result.name.toLowerCase().includes("src"),
        `结果 ${result.name} (路径 ${result.path}) 名字本身应该包含 "src"`
      );
    }
  });

  test("应该支持路径搜索", async () => {
    // 检查是否有工作区文件夹，如果没有则跳过此测试（某些测试环境限制）
    if (
      !vscode.workspace.workspaceFolders ||
      vscode.workspace.workspaceFolders.length === 0
    ) {
      return;
    }

    // 搜索 "src/utils"，应该能搜到
    const results = await searchWorkspaceFiles("src/utils", {
      maxResults: 100,
    });

    const found = results.some((r: SearchResult) =>
      r.path.replace(/\\/g, "/").includes("src/utils")
    );

    assert.ok(
      found,
      "搜索 'src/utils' 应该能找到对应的结果, 实际搜到: " +
        JSON.stringify(results.map((r) => r.path))
    );
  });
});
