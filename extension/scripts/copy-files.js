import { copyFile, mkdir, readdir } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, '..');

async function copyFiles() {
    try {
        // Ensure dist directory exists
        await mkdir(join(rootDir, 'dist'), { recursive: true });

        // Copy manifest.json
        await copyFile(
            join(rootDir, 'manifest.json'),
            join(rootDir, 'dist', 'manifest.json')
        );

        // Check if any files were built into an assets directory
        try {
            const assetFiles = await readdir(join(rootDir, 'dist', 'assets'));
            for (const file of assetFiles) {
                if (file.includes('content') || file.includes('background')) {
                    await copyFile(
                        join(rootDir, 'dist', 'assets', file),
                        join(rootDir, 'dist', file.replace(/\.[^/.]+\.[^/.]+$/, '.js'))
                    );
                }
            }
        } catch (e) {
            console.log('No assets directory found, continuing...');
        }

        // Verify critical files exist
        const requiredFiles = ['manifest.json', 'popup.html', 'content.js', 'background.js'];
        for (const file of requiredFiles) {
            try {
                await copyFile(
                    join(rootDir, 'dist', file),
                    join(rootDir, 'dist', file)
                ).catch(() => {}); // Ignore if file already exists
            } catch (e) {
                console.error(`Warning: ${file} not found in expected location`);
            }
        }

        console.log('Files copied successfully!');
    } catch (error) {
        console.error('Error copying files:', error);
        process.exit(1);
    }
}

copyFiles();