#!/usr/bin/env python3
"""
Claude Code セッション保存スクリプト（VSCode拡張機能対応版）

使い方:
  python save_session.py              # 最新のセッションを自動で探して保存
  python save_session.py --list       # 最近のセッション一覧を表示
  python save_session.py --all        # 全セッションを一括変換
  python save_session.py <path.jsonl> # パスを直接指定
"""

import json
import sys
import os
import argparse
from datetime import datetime
from pathlib import Path


# -------------------------------------------------------
# JONLの読み込み
# -------------------------------------------------------
def load_jsonl(path: Path) -> list[dict]:
    entries = []
    with open(path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                try:
                    entries.append(json.loads(line))
                except json.JSONDecodeError:
                    continue
    return entries


# -------------------------------------------------------
# トランスクリプトの検索
# -------------------------------------------------------
def find_transcripts_dir() -> Path:
    """~/.claude/projects/ を返す"""
    return Path.home() / ".claude" / "projects"


def find_all_jsonl(projects_dir: Path) -> list[Path]:
    """全JONLファイルを更新日時の新しい順で返す"""
    files = list(projects_dir.rglob("*.jsonl"))
    files = [f for f in files if f.stat().st_size > 100]  # 空ファイルを除外
    files.sort(key=lambda f: f.stat().st_mtime, reverse=True)
    return files


def find_latest_jsonl(projects_dir: Path) -> Path | None:
    """最も最近更新されたJSONLを返す"""
    files = find_all_jsonl(projects_dir)
    return files[0] if files else None


# -------------------------------------------------------
# コンテンツの抽出
# -------------------------------------------------------
def extract_text_content(content) -> str:
    if isinstance(content, str):
        return content.strip()
    if isinstance(content, list):
        parts = []
        for block in content:
            if not isinstance(block, dict):
                continue
            btype = block.get("type", "")
            if btype == "text":
                text = block.get("text", "").strip()
                if text:
                    parts.append(text)
            elif btype == "tool_use":
                name = block.get("name", "tool")
                inp = block.get("input", {})
                inp_str = json.dumps(inp, ensure_ascii=False, indent=2)
                parts.append(f"*🔧 ツール実行: `{name}`*\n```\n{inp_str}\n```")
            elif btype == "tool_result":
                result = block.get("content", "")
                if isinstance(result, list):
                    result = " ".join(
                        b.get("text", "") for b in result if isinstance(b, dict)
                    )
                if isinstance(result, str) and result.strip():
                    parts.append(f"*📤 結果:*\n```\n{result.strip()}\n```")
        return "\n\n".join(parts)
    return ""


# -------------------------------------------------------
# トークン集計
# -------------------------------------------------------
def calc_token_totals(entries: list[dict]) -> dict:
    totals = {
        "input_tokens": 0,
        "output_tokens": 0,
        "cache_creation_input_tokens": 0,
        "cache_read_input_tokens": 0,
    }
    for entry in entries:
        usage = entry.get("message", {}).get("usage") or entry.get("usage")
        if not usage:
            continue
        for key in totals:
            totals[key] += usage.get(key, 0)
    return totals


# -------------------------------------------------------
# Markdown変換
# -------------------------------------------------------
def convert_to_markdown(jsonl_path: Path, output_path: Path | None = None) -> Path | None:
    entries = load_jsonl(jsonl_path)
    if not entries:
        print(f"  ⚠ エントリが空です: {jsonl_path.name}")
        return None

    # セッション情報
    session_id = entries[0].get("sessionId", "unknown")
    cwd = entries[0].get("cwd", "")

    timestamps = [e.get("timestamp") for e in entries if e.get("timestamp")]
    start_time = min(timestamps) if timestamps else ""
    end_time = max(timestamps) if timestamps else ""

    # トークン集計
    tokens = calc_token_totals(entries)
    total_input = tokens["input_tokens"]
    total_output = tokens["output_tokens"]
    total_cache_create = tokens["cache_creation_input_tokens"]
    total_cache_read = tokens["cache_read_input_tokens"]
    grand_total = total_input + total_output + total_cache_create + total_cache_read

    # 出力先の決定
    if output_path is None:
        # プロジェクト名の取得（優先順位順）
        # 1. cwd の末尾フォルダ名
        # 2. JONLの親フォルダ名（例: c--dev-nekoegaku → nekoegaku）
        # 3. "unknown"
        if cwd and Path(cwd).name:
            project_name = Path(cwd).name
        else:
            # ~/.claude/projects/c--dev-nekoegaku/ の形式からプロジェクト名を復元
            # C:\dev\nekoegaku → c--dev-nekoegaku のように変換されているので
            # ドライブレター部分（例: c--）を除去してパスの最後のセグメントを取る
            import re as _re
            folder = jsonl_path.parent.name  # 例: c--dev-nekoegaku
            path_part = _re.sub(r'^[a-z]--', '', folder)  # dev-nekoegaku
            segments = path_part.split("-")
            project_name = segments[-1] if segments else "unknown"

        # ~/Documents/claude-logs/<project-name>/ に保存
        log_dir = Path.home() / "Documents" / "claude-logs" / project_name
        log_dir.mkdir(parents=True, exist_ok=True)

        # ファイル名はセッション開始時刻＋セッションID短縮形（上書き防止）
        if start_time:
            try:
                dt = datetime.fromisoformat(start_time.replace("Z", "+00:00"))
                date_str = dt.strftime("%Y%m%d-%H%M%S")
            except Exception:
                date_str = datetime.now().strftime("%Y%m%d-%H%M%S")
        else:
            date_str = datetime.now().strftime("%Y%m%d-%H%M%S")
        short_id = session_id[:8] if len(session_id) >= 8 else session_id
        output_path = log_dir / f"session-{date_str}-{short_id}.md"

    # Markdown組み立て
    now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    lines = [
        "# Claude Code セッションログ",
        "",
        "## セッション情報",
        "",
        "| 項目 | 値 |",
        "|------|-----|",
        f"| セッションID | `{session_id}` |",
        f"| 作業ディレクトリ | `{cwd}` |",
        f"| 開始時刻 | {start_time} |",
        f"| 終了時刻 | {end_time} |",
        f"| 保存日時 | {now_str} |",
        "",
        "## トークン使用量",
        "",
        "| 種別 | トークン数 |",
        "|------|-----------|",
        f"| 入力トークン | {total_input:,} |",
        f"| 出力トークン | {total_output:,} |",
        f"| キャッシュ作成 | {total_cache_create:,} |",
        f"| キャッシュ読み込み | {total_cache_read:,} |",
        f"| **合計** | **{grand_total:,}** |",
        "",
        "---",
        "",
        "## 会話ログ",
        "",
    ]

    msg_count = 0
    for entry in entries:
        if entry.get("isSidechain"):
            continue

        entry_type = entry.get("type", "")
        msg = entry.get("message", {})
        role = msg.get("role", "")
        content = msg.get("content", "")
        ts = entry.get("timestamp", "")
        ts_display = f" *({ts})*" if ts else ""

        # compactによる要約
        if entry_type == "summary":
            summary_text = entry.get("summary", "")
            lines += ["### 📋 コンパクト要約", "", summary_text, ""]
            continue

        text = extract_text_content(content)
        if not text:
            continue

        if role == "user":
            lines += [f"### 👤 ユーザー{ts_display}", "", text, ""]
            msg_count += 1
        elif role == "assistant":
            lines += [f"### 🤖 Claude{ts_display}", "", text, ""]
            msg_count += 1

    # メッセージ数をヘッダーに追記
    lines.insert(10, f"| メッセージ数 | {msg_count} |")

    md_content = "\n".join(lines)
    output_path.write_text(md_content, encoding="utf-8")
    return output_path


# -------------------------------------------------------
# セッション一覧表示
# -------------------------------------------------------
def show_list(projects_dir: Path, limit: int = 10):
    files = find_all_jsonl(projects_dir)[:limit]
    if not files:
        print("セッションが見つかりませんでした。")
        return
    print(f"\n最近の{len(files)}件のセッション:\n")
    for i, f in enumerate(files, 1):
        mtime = datetime.fromtimestamp(f.stat().st_mtime).strftime("%Y-%m-%d %H:%M")
        size_kb = f.stat().st_size // 1024
        # cwdを取得して表示
        try:
            first_line = f.read_text(encoding="utf-8").split("\n")[0]
            cwd = json.loads(first_line).get("cwd", "")
            project_name = Path(cwd).name if cwd else f.parent.name
        except Exception:
            project_name = f.parent.name
        print(f"  [{i:2}] {mtime}  {project_name:<30}  {size_kb:>5} KB  {f.name[:16]}...")
    print()


# -------------------------------------------------------
# メイン
# -------------------------------------------------------
def main():
    parser = argparse.ArgumentParser(description="Claude CodeセッションをMD形式で保存")
    parser.add_argument("path", nargs="?", help="JONLファイルのパス（省略時は最新を自動選択）")
    parser.add_argument("--list", "-l", action="store_true", help="最近のセッション一覧を表示")
    parser.add_argument("--all", "-a", action="store_true", help="全セッションを一括変換")
    parser.add_argument("--limit", type=int, default=10, help="--listの表示件数（デフォルト10）")
    args = parser.parse_args()

    projects_dir = find_transcripts_dir()

    # 一覧表示
    if args.list:
        if not projects_dir.exists():
            print(f"エラー: {projects_dir} が見つかりません。")
            sys.exit(1)
        show_list(projects_dir, args.limit)
        return

    # 一括変換
    if args.all:
        if not projects_dir.exists():
            print(f"エラー: {projects_dir} が見つかりません。")
            sys.exit(1)
        files = find_all_jsonl(projects_dir)
        print(f"{len(files)}件のセッションを変換します...\n")
        ok = 0
        for f in files:
            result = convert_to_markdown(f)
            if result:
                print(f"  ✓ {result}")
                ok += 1
        print(f"\n完了: {ok}/{len(files)}件 変換しました。")
        return

    # パス指定または最新を自動選択
    if args.path:
        jsonl_path = Path(args.path)
        if not jsonl_path.exists():
            print(f"エラー: ファイルが見つかりません: {args.path}")
            sys.exit(1)
    else:
        if not projects_dir.exists():
            print(f"エラー: {projects_dir} が見つかりません。")
            sys.exit(1)
        jsonl_path = find_latest_jsonl(projects_dir)
        if jsonl_path is None:
            print("エラー: セッションファイルが見つかりませんでした。")
            sys.exit(1)
        mtime = datetime.fromtimestamp(jsonl_path.stat().st_mtime).strftime("%Y-%m-%d %H:%M:%S")
        print(f"最新のセッションを使用: {jsonl_path.name} (更新: {mtime})")

    result = convert_to_markdown(jsonl_path)
    if result:
        print(f"\n✅ 保存しました:\n   {result}")
    else:
        print("変換に失敗しました。")
        sys.exit(1)


if __name__ == "__main__":
    main()
