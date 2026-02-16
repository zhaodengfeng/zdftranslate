#!/usr/bin/env python3
"""ZDFTranslate 打包脚本（发布包）

- 从 src/manifest.json 读取版本号
- 生成 zdf-translate-vX.Y.Z.zip（仅版本号，不带说明后缀）
- 递归打包 src 下所有发布资源，避免遗漏（如 assets）
"""

import json
import os
import zipfile
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent
SRC_DIR = PROJECT_ROOT / 'src'

EXCLUDE_SUFFIXES = {'.map'}
EXCLUDE_NAMES = {
    '.DS_Store',
    'Thumbs.db',
}


def get_version() -> str:
    manifest_path = SRC_DIR / 'manifest.json'
    if not manifest_path.exists():
        raise FileNotFoundError(f'找不到 manifest.json: {manifest_path}')

    with manifest_path.open('r', encoding='utf-8') as f:
        manifest = json.load(f)

    return str(manifest.get('version', '1.0.0')).strip() or '1.0.0'


def should_include(path: Path) -> bool:
    if not path.is_file():
        return False
    if path.name in EXCLUDE_NAMES:
        return False
    if path.suffix.lower() in EXCLUDE_SUFFIXES:
        return False
    return True


def create_package() -> Path:
    version = get_version()
    zip_path = PROJECT_ROOT / f'zdf-translate-v{version}.zip'

    if zip_path.exists():
        zip_path.unlink()

    print(f'🚀 开始打包 ZDFTranslate v{version}...')

    files = sorted(p for p in SRC_DIR.rglob('*') if should_include(p))
    if not files:
        raise RuntimeError('未找到可打包文件，请检查 src 目录')

    with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as zf:
        for f in files:
            arc_name = f.relative_to(SRC_DIR).as_posix()
            zf.write(f, arc_name)
            print(f'  ✓ {arc_name}')

    size = zip_path.stat().st_size
    size_mb = size / (1024 * 1024)
    print(f'\n✅ 打包完成: {zip_path.name}')
    print(f'📦 文件大小: {size_mb:.2f} MB ({size:,} bytes)')

    return zip_path


if __name__ == '__main__':
    os.chdir(PROJECT_ROOT)
    try:
        if not SRC_DIR.exists():
            print('❌ 错误: 找不到 src 目录，请在项目根目录运行')
        else:
            create_package()
    except Exception as e:
        print(f'❌ 错误: {e}')
        raise
