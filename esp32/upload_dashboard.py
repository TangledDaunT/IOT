#!/usr/bin/env python3
"""
LittleFS Upload Script for ESP32

This script:
1. Builds the React app
2. Copies minified files to esp32/data/
3. Creates a LittleFS image
4. Uploads to ESP32

Prerequisites:
  pip install esptool littlefs-python

Usage:
  python esp32/upload_dashboard.py --port /dev/cu.usbserial-0001

Or just prepare the data folder for Arduino IDE upload:
  python esp32/upload_dashboard.py --prepare-only
"""

import os
import sys
import shutil
import subprocess
import argparse
import gzip
from pathlib import Path

# Configuration
PROJECT_ROOT = Path(__file__).parent.parent
ESP32_DIR = PROJECT_ROOT / "esp32"
DATA_DIR = ESP32_DIR / "data"
DIST_DIR = PROJECT_ROOT / "dist"

# LittleFS partition settings (adjust if your partition scheme differs)
LITTLEFS_ADDR = 0x290000  # Default partition offset
LITTLEFS_SIZE = 0x170000  # 1.5MB partition size


def run_command(cmd, cwd=None):
    """Run a shell command and handle errors."""
    print(f"  → {' '.join(cmd) if isinstance(cmd, list) else cmd}")
    result = subprocess.run(cmd, cwd=cwd, shell=isinstance(cmd, str))
    if result.returncode != 0:
        print(f"Error: Command failed with code {result.returncode}")
        sys.exit(1)


def build_react():
    """Build the React app for production."""
    print("\n📦 Building React app...")
    run_command("npm run build:esp32", cwd=PROJECT_ROOT)


def prepare_data_folder():
    """Copy and optimize built files to esp32/data/."""
    print("\n📂 Preparing data folder...")
    
    # Clean existing data folder
    if DATA_DIR.exists():
        shutil.rmtree(DATA_DIR)
    DATA_DIR.mkdir(parents=True)
    
    # Copy all files from dist to data
    for item in DIST_DIR.iterdir():
        dest = DATA_DIR / item.name
        if item.is_dir():
            shutil.copytree(item, dest)
        else:
            shutil.copy2(item, dest)
    
    # Optionally gzip large files while keeping originals.
    # Keeping originals avoids root/index fallback issues on some setups.
    gzip_extensions = {'.html', '.js', '.css', '.svg', '.json'}
    total_saved = 0
    
    for file in DATA_DIR.rglob('*'):
        if file.is_file() and file.suffix in gzip_extensions:
            original_size = file.stat().st_size
            gz_path = file.with_suffix(file.suffix + '.gz')
            
            with open(file, 'rb') as f_in:
                with gzip.open(gz_path, 'wb', compresslevel=9) as f_out:
                    f_out.write(f_in.read())
            
            gz_size = gz_path.stat().st_size
            saved = original_size - gz_size
            total_saved += saved
            
            print(f"  Compressed: {file.name} ({original_size}B → {gz_size}B, saved {saved}B)")
    
    print(f"\n  Total compression savings: {total_saved / 1024:.1f} KB")
    
    # Calculate total size
    total_size = sum(f.stat().st_size for f in DATA_DIR.rglob('*') if f.is_file())
    print(f"  Total data folder size: {total_size / 1024:.1f} KB")
    
    if total_size > LITTLEFS_SIZE:
        print(f"\n⚠️  Warning: Data exceeds LittleFS partition size ({LITTLEFS_SIZE / 1024:.0f} KB)")
        print("   Consider reducing bundle size or increasing partition.")


def create_littlefs_image():
    """Create a LittleFS binary image."""
    print("\n🔧 Creating LittleFS image...")
    
    image_path = ESP32_DIR / "littlefs.bin"
    
    try:
        from littlefs import LittleFS
        
        # Create filesystem
        fs = LittleFS(block_size=4096, block_count=LITTLEFS_SIZE // 4096)
        
        for file in DATA_DIR.rglob('*'):
            if file.is_file():
                rel_path = '/' + str(file.relative_to(DATA_DIR))
                with open(file, 'rb') as f:
                    fs.makedirs(str(Path(rel_path).parent), exist_ok=True)
                    with fs.open(rel_path, 'wb') as lfs_file:
                        lfs_file.write(f.read())
                print(f"  Added: {rel_path}")
        
        # Write image
        with open(image_path, 'wb') as f:
            f.write(fs.context.buffer)
        
        print(f"  Created: {image_path}")
        return image_path
        
    except ImportError:
        print("  ⚠️  littlefs-python not installed. Install with: pip install littlefs-python")
        print("  Alternatively, use Arduino IDE → ESP32 Sketch Data Upload")
        return None


def upload_to_esp32(port, image_path):
    """Upload LittleFS image to ESP32."""
    print(f"\n🚀 Uploading to ESP32 on {port}...")
    
    try:
        import esptool
    except ImportError:
        print("  ⚠️  esptool not installed. Install with: pip install esptool")
        return False
    
    cmd = [
        sys.executable, "-m", "esptool",
        "--chip", "esp32",
        "--port", port,
        "--baud", "921600",
        "write_flash",
        hex(LITTLEFS_ADDR), str(image_path)
    ]
    
    run_command(cmd)
    print("\n✅ Upload complete!")
    return True


def main():
    parser = argparse.ArgumentParser(description="Build and upload dashboard to ESP32")
    parser.add_argument("--port", "-p", help="Serial port (e.g., /dev/cu.usbserial-0001)")
    parser.add_argument("--prepare-only", action="store_true", 
                       help="Only prepare data folder (for Arduino IDE upload)")
    parser.add_argument("--skip-build", action="store_true",
                       help="Skip npm build (use existing dist/)")
    args = parser.parse_args()
    
    print("═" * 50)
    print("  ESP32 Dashboard Upload Tool")
    print("═" * 50)
    
    # Build React app
    if not args.skip_build:
        build_react()
    elif not DIST_DIR.exists():
        print("Error: dist/ folder not found. Run without --skip-build first.")
        sys.exit(1)
    
    # Prepare data folder
    prepare_data_folder()
    
    if args.prepare_only:
        print("\n" + "═" * 50)
        print("  Data folder ready: esp32/data/")
        print("  Upload using Arduino IDE:")
        print("    Tools → ESP32 Sketch Data Upload")
        print("═" * 50)
        return
    
    # Create and upload image
    if args.port:
        image_path = create_littlefs_image()
        if image_path:
            upload_to_esp32(args.port, image_path)
    else:
        print("\n" + "═" * 50)
        print("  No port specified. To upload:")
        print("    python esp32/upload_dashboard.py --port /dev/cu.usbserial-XXXX")
        print("  Or use Arduino IDE → ESP32 Sketch Data Upload")
        print("═" * 50)


if __name__ == "__main__":
    main()
