import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Browser } from '@capacitor/browser';

const readBlobSafe = (b) => {
    if (b.arrayBuffer) return b.arrayBuffer();
    return new Promise((res, rej) => {
        const r = new FileReader();
        r.onload = () => res(r.result);
        r.onerror = rej;
        r.readAsArrayBuffer(b);
    });
};

const makeFakeFile = (blob, fileName) => {
    try {
        return new File([blob], fileName, { type: blob.type || 'application/octet-stream' });
    } catch (e) {
        blob.name = fileName;
        blob.lastModified = Date.now();
        return blob;
    }
};

// --- НОВЫЙ МОСТ ДЛЯ ЖЕСТКОГО СОХРАНЕНИЯ ZIP В ПАМЯТЬ ANDROID ---
window.nativeSaveZip = async (blob, fileName) => {
    try {
        // Конвертируем Blob в чистый Base64 (без префикса data:...)
        const base64Data = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => {
                const base64 = reader.result.split(',')[1];
                resolve(base64);
            };
            reader.onerror = reject;
            reader.readAsDataURL(blob);
        });

        // Жестко пишем файл в папку "Документы" устройства
        await Filesystem.writeFile({
            path: fileName,
            data: base64Data,
            directory: Directory.Documents
        });

        if (typeof showToast === 'function') {
            showToast(`Успешно! Архив ${fileName} сохранен в папку "Документы".`, 'success', 4000);
        } else {
            alert(`Архив ${fileName} сохранен в папку "Документы"!`);
        }
        return true;
    } catch (err) {
        console.error('Ошибка Capacitor Filesystem:', err);
        if (typeof showToast === 'function') {
            showToast('Ошибка сохранения: ' + err.message, 'error', 4000);
        } else {
            alert('Ошибка сохранения: ' + err.message);
        }
        return false;
    }
};

document.addEventListener('DOMContentLoaded', () => {
    if (typeof Archive !== 'undefined') {
        Archive.init({ workerUrl: 'worker-bundle.js' });
    }

    const externalLinks = document.querySelectorAll('a[target="_blank"]');
    externalLinks.forEach(link => {
        link.addEventListener('click', async (e) => {
            e.preventDefault();
            const targetUrl = link.href;
            if (Capacitor.isNativePlatform()) {
                try {
                    await Browser.open({ url: targetUrl, presentationStyle: 'popover', toolbarColor: '#1f2937' });
                    if (!window._browserListenerAdded) {
                        Browser.addListener('browserFinished', () => { 
                            // Автозапуск радара отключен
                        });
                        window._browserListenerAdded = true;
                    }
                    return; 
                } catch (err) {}
            }
            window.open(targetUrl, '_blank');
        });
    });
});

async function scanDownloadFolder() {
    let allFiles = [];
    async function walk(currentPath, depth) {
        if (depth > 3) return; 
        try {
            let dir = await Filesystem.readdir({ path: currentPath, directory: Directory.ExternalStorage });
            let filesArray = dir.files || [];
            for (let i = 0; i < filesArray.length; i++) {
                let item = filesArray[i];
                let name = typeof item === 'string' ? item : item.name;
                let type = typeof item === 'string' ? 'unknown' : item.type;
                let fullPath = currentPath === 'Download' ? `Download/${name}` : `${currentPath}/${name}`;
                
                if (type === 'directory' || (typeof item === 'object' && item.type === 'directory')) {
                    await walk(fullPath, depth + 1);
                } else if (type === 'file' || (typeof item === 'object' && item.type === 'file')) {
                    allFiles.push({ name: name, path: fullPath });
                } else {
                    try {
                        let stat = await Filesystem.stat({ path: fullPath, directory: Directory.ExternalStorage });
                        if (stat.type === 'directory') await walk(fullPath, depth + 1);
                        else allFiles.push({ name: name, path: fullPath });
                    } catch(e) {
                        allFiles.push({ name: name, path: fullPath });
                    }
                }
            }
        } catch(e) { console.error("Ошибка чтения папки:", currentPath, e); }
    }
    await walk('Download', 0);
    return allFiles;
}

window.isRadarRunning = false;

async function runDownloadRadar(manualTrigger = true) {
    console.log("📡 Сканер загрузок временно отключен. Используйте ручное добавление игр.");
    return;
}
window.runDownloadRadar = runDownloadRadar;

function promptRadarInstall(filesObjects) {
    console.log("📡 Окно установки радара заблокировано.");
}

function isRealRom(fileName, fileDataU8) {
    const lower = fileName.toLowerCase();
    const ext = lower.split('.').pop();
    if (!['nes', 'md', 'sfc', 'smc', 'gen', 'bin', 'ngp', 'ngc'].includes(ext)) return false;

    const trashPatterns = ['readme', 'aliases', 'utech', 'info', 'license', 'manual', 'caching', 'code_of_conduct', 'changes', 'contributing', 'contributors'];
    const baseName = lower.replace(/\.[^/.]+$/, '');
    if (trashPatterns.some(p => baseName.includes(p))) return false;

    if (fileDataU8.length < 4096) return false;

    let isText = true;
    let checkLen = Math.min(fileDataU8.length, 100);
    for(let i = 0; i < checkLen; i++) {
        let b = fileDataU8[i];
        if (!( (b >= 32 && b < 127) || b === 0x0A || b === 0x0D || b === 0x09 )) {
            isText = false; break;
        }
    }
    if (isText) return false;

    return true; 
}

document.addEventListener('DOMContentLoaded', () => {
    const initExtendedProcessor = () => {
        if (typeof window.processSingleFile !== 'function') {
            setTimeout(initExtendedProcessor, 50);
            return;
        }
        if (window.processSingleFile.isExtended) return;
        
        const coreProcessSingleFile = window.processSingleFile;
        
        window.processSingleFileExtended = async function(file) {
            const fileName = file.name.toLowerCase();
            const validRomExts = ['.nes', '.md', '.sfc', '.smc', '.gen', '.bin', '.ngp', '.ngc'];
            const validDosExts = ['.exe', '.bin', '.bat', '.com'];
            const validArchiveExts = ['.zip', '.rar', '.7z'];
            
            if ((fileName.endsWith('.rar') || fileName.endsWith('.7z')) && typeof Archive !== 'undefined') {
                const archive = await Archive.open(file);
                const extractedFiles = await archive.getFilesObject();
                
                let fileList = [];
                function flatten(obj, path = '') {
                    for (let key in obj) {
                        if (obj[key] instanceof File) fileList.push({ path: path + key, file: obj[key] });
                        else if (typeof obj[key] === 'object') flatten(obj[key], path + key + '/');
                    }
                }
                flatten(extractedFiles);

                let dosFiles = fileList.filter(f => validDosExts.some(ext => f.path.toLowerCase().endsWith(ext)));
                let nestedArchives = fileList.filter(f => validArchiveExts.some(ext => f.path.toLowerCase().endsWith(ext)));
                
                let romFiles = [];
                for (let f of fileList) {
                    if (validRomExts.some(ext => f.path.toLowerCase().endsWith(ext))) {
                        const buffer = await readBlobSafe(f.file);
                        if (isRealRom(f.path.split('/').pop(), new Uint8Array(buffer))) {
                            romFiles.push({ path: f.path, file: f.file });
                        }
                    }
                }

                let hasValidContent = false;

                if (nestedArchives.length > 0) {
                    for (let f of nestedArchives) {
                        let cleanName = f.path.split('/').pop();
                        let newFile = new File([await readBlobSafe(f.file)], cleanName);
                        await window.processSingleFileExtended(newFile);
                        await new Promise(r => setTimeout(r, 500));
                    }
                    hasValidContent = true;
                }

                if (romFiles.length > 0) {
                    for (let f of romFiles) {
                        let cleanName = f.path.split('/').pop();
                        let newFile = new File([await readBlobSafe(f.file)], cleanName);
                        await coreProcessSingleFile(newFile);
                        await new Promise(r => setTimeout(r, 500));
                    }
                    hasValidContent = true;
                }

                if (!hasValidContent && dosFiles.length > 0) {
                    const exes = dosFiles.map(f => f.path.split('/').pop().toLowerCase());
                    const priority = ['go.bat', 'go.exe', 'start.bat', 'start.exe', 'play.bat', 'play.exe', 'run.bat', 'run.exe']; 
                    let hasExe = exes.some(e => e.endsWith('.exe') || e.endsWith('.bat') || e.endsWith('.com'));
                    
                    if (hasExe) {
                        const zipData = {};
                        for (let f of fileList) zipData[f.path] = new Uint8Array(await readBlobSafe(f.file));
                        if (typeof fflate !== 'undefined') {
                            const zipped = fflate.zipSync(zipData);
                            let zipBlob = new Blob([zipped], {type: 'application/zip'});
                            let newZipFile = makeFakeFile(zipBlob, file.name.replace(/\.(rar|7z)$/i, '.zip'));
                            await coreProcessSingleFile(newZipFile);
                            hasValidContent = true;
                        }
                    }
                }

                if (!hasValidContent) throw new Error("Архив пуст или содержит мусор");
                return;
            } 
            else if (fileName.endsWith('.zip')) {
                const buffer = await readBlobSafe(file);
                const arr = new Uint8Array(buffer);
                let unzipped;
                try { unzipped = fflate.unzipSync(arr); } catch(e) { throw new Error("Ошибка чтения ZIP"); }

                let hasDos = false, romFiles = [], nestedArchives = [];
                for (const path in unzipped) {
                    const lowPath = path.toLowerCase();
                    const data = unzipped[path];
                    
                    if (validDosExts.some(ext => lowPath.endsWith(ext))) hasDos = true;
                    if (validArchiveExts.some(ext => lowPath.endsWith(ext))) nestedArchives.push({ path, data });
                    
                    if (validRomExts.some(ext => lowPath.endsWith(ext))) {
                        if (isRealRom(path.split('/').pop(), data)) {
                            romFiles.push({ path, data });
                        }
                    }
                }

                let hasValidContent = false;

                if (nestedArchives.length > 0) {
                    for (let arc of nestedArchives) {
                        let cleanName = arc.path.split('/').pop();
                        let newBlob = new Blob([arc.data], {type: 'application/octet-stream'});
                        let newFile = makeFakeFile(newBlob, cleanName);
                        await window.processSingleFileExtended(newFile);
                        await new Promise(r => setTimeout(r, 500));
                    }
                    hasValidContent = true;
                }

                if (romFiles.length > 0) {
                    for (let rom of romFiles) {
                        let cleanName = rom.path.split('/').pop();
                        let newBlob = new Blob([rom.data], {type: 'application/octet-stream'});
                        let newFile = makeFakeFile(newBlob, cleanName);
                        await coreProcessSingleFile(newFile);
                        await new Promise(r => setTimeout(r, 500));
                    }
                    hasValidContent = true;
                }

                if (!hasValidContent && hasDos) {
                    let hasExe = false;
                    for (const path in unzipped) {
                        const low = path.toLowerCase();
                        if (low.endsWith('.exe') || low.endsWith('.bat') || low.endsWith('.com')) {
                            hasExe = true; break;
                        }
                    }
                    if (hasExe) {
                        await coreProcessSingleFile(file);
                        hasValidContent = true;
                    }
                }

                if (!hasValidContent) throw new Error("Архив пуст или содержит мусор");
                return;
            }
            return await coreProcessSingleFile(file);
        };
        window.processSingleFileExtended.isExtended = true;
        window.processSingleFile = window.processSingleFileExtended;
    };
    initExtendedProcessor();
});
