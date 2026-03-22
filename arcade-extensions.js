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
                    await Browser.open({ 
                        url: targetUrl, 
                        presentationStyle: 'popover',
                        toolbarColor: '#1f2937' 
                    });
                    
                    if (!window._browserListenerAdded) {
                        Browser.addListener('browserFinished', () => {
                            setTimeout(runDownloadRadar, 1500); 
                        });
                        window._browserListenerAdded = true;
                    }
                    return; 
                } catch (err) {
                    console.error('Browser plugin ошибка:', err);
                }
            }
            window.open(targetUrl, '_blank');
        });
    });

    setTimeout(() => runDownloadRadar(false), 2000);
});

// КРАСИВОЕ ОКНО ДЛЯ ПЕРЕХОДА В НАСТРОЙКИ АНДРОИДА (ФИКС ДЛЯ MIUI)
function showEmptyOrPermissionModal() {
    if (document.getElementById('radar-empty-overlay')) return;

    const overlay = document.createElement('div');
    overlay.id = 'radar-empty-overlay';
    overlay.style.cssText = 'position:fixed; inset:0; background:rgba(0,0,0,0.9); z-index:99999; display:flex; align-items:center; justify-content:center; padding:20px; flex-direction:column; backdrop-filter:blur(5px);';
    
    const modal = document.createElement('div');
    modal.style.cssText = 'background:#1f2937; border:2px solid #38bdf8; border-radius:12px; padding:20px; width:100%; max-width:350px; text-align:center; color:#fff; box-shadow: 0 10px 25px rgba(0,0,0,0.8);';
    
    modal.innerHTML = `
        <h3 style="margin-top:0; color:#38bdf8;">РАДАР ЗАГРУЗОК 📡</h3>
        <p style="font-size:13px; color:#94a3b8; margin-bottom:20px;">
            В папке "Загрузки" не найдено новых архивов с играми.<br><br>
            <b style="color:#ef4444;">⚠️ ВАЖНО ДЛЯ ANDROID 11+:</b><br>
            Если вы <b>точно</b> скачали игры, но эмулятор их не видит — ваша система (Xiaomi/MIUI) скрывает папку!<br><br>
            Нажмите кнопку ниже и выдайте <b>Специальные разрешения ➔ Доступ ко всем файлам</b>.
        </p>
        <button id="empty-settings-btn" class="action-btn" style="width:100%; background:#ef4444; color:#fff; border:none; padding:12px; border-radius:8px; font-weight:bold; margin-bottom:10px; cursor:pointer;">⚙️ ОТКРЫТЬ НАСТРОЙКИ</button>
        <button id="empty-close-btn" class="action-btn" style="width:100%; background:#475569; color:#fff; border:none; padding:12px; border-radius:8px; font-weight:bold; cursor:pointer;">ОК, ПОНЯТНО</button>
    `;
    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    document.getElementById('empty-settings-btn').onclick = () => {
        window.location.href = "intent:#Intent;action=android.settings.MANAGE_APP_ALL_FILES_ACCESS_PERMISSION;package=com.arcade.hub;end";
        setTimeout(() => {
            window.location.href = "intent:#Intent;action=android.settings.APPLICATION_DETAILS_SETTINGS;data=package:com.arcade.hub;end";
        }, 800);
        overlay.remove();
    };

    document.getElementById('empty-close-btn').onclick = () => {
        overlay.remove();
    };
}

async function requestStoragePermission() {
    if (window.NativeFilesystem && window.NativeFilesystem.requestPermissions) {
        try {
            const result = await window.NativeFilesystem.requestPermissions();
            return result.publicStorage === 'granted';
        } catch(e) {
            console.log('Permission request error:', e);
        }
    }
    return true; 
}

async function runDownloadRadar(manualTrigger = false) {
    if (!Capacitor.isNativePlatform()) {
        console.log('Радар: Работаем в браузере, сканер отключен.');
        if (manualTrigger) alert('📡 Радар работает только в скомпилированном APK');
        return;
    }
    
    if (manualTrigger) {
        try { await Filesystem.requestPermissions(); } catch(e) {}
    }
    
    try {
        let result = await Filesystem.readdir({
            path: 'Download',
            directory: Directory.ExternalStorage
        });
        
        if (!result || !Array.isArray(result.files)) {
            if (manualTrigger) showEmptyOrPermissionModal();
            return;
        }

        let ignoredFiles = JSON.parse(localStorage.getItem('radar_ignored')) || [];
        const validExtensions = ['.zip', '.rar', '.7z', '.nes', '.smc', '.sfc', '.md', '.gen', '.bin', '.ngp', '.ngc'];
        
        const newFiles = result.files.filter(f => {
            const fileName = (f.name || f).toLowerCase(); 
            return validExtensions.some(ext => fileName.endsWith(ext)) && !ignoredFiles.includes(f.name || f);
        });

        if (newFiles.length > 0) {
            promptRadarInstall(newFiles);
        } else {
            if (manualTrigger) showEmptyOrPermissionModal();
        }
    } catch (error) {
        console.error('Радар: Ошибка чтения папки Download:', error);
        if (manualTrigger || !localStorage.getItem('radar_perm_shown')) {
            showEmptyOrPermissionModal();
            localStorage.setItem('radar_perm_shown', 'true'); 
        }
    }
}

window.runDownloadRadar = runDownloadRadar;

function promptRadarInstall(files) {
    const overlay = document.createElement('div');
    overlay.id = 'radar-overlay';
    overlay.style.cssText = 'position:fixed; inset:0; background:rgba(0,0,0,0.9); z-index:99999; display:flex; align-items:center; justify-content:center; padding:20px; flex-direction:column; backdrop-filter:blur(5px);';
    
    const modal = document.createElement('div');
    modal.style.cssText = 'background:#1f2937; border:2px solid #38bdf8; border-radius:12px; padding:20px; width:100%; max-width:350px; text-align:center; color:#fff; box-shadow: 0 10px 25px rgba(0,0,0,0.8);';
    
    let fileNamesHtml = files.slice(0, 3).map(f => `<strong style="color:#fff; word-break:break-all;">${f.name || f}</strong>`).join('<br>');
    if (files.length > 3) fileNamesHtml += `<br><span style="color:#aaa; font-size:11px;">...и еще ${files.length - 3} файлов</span>`;

    modal.innerHTML = `
        <h3 style="margin-top:0; color:#38bdf8;">РАДАР ЗАГРУЗОК 📡</h3>
        <p style="font-size:13px; color:#94a3b8; margin-bottom:20px;">Найдено файлов (архивов/игр): <b>${files.length}</b><br><br>${fileNamesHtml}</p>
        <button id="radar-install-btn" class="action-btn" style="width:100%; background:#10b981; color:#fff; border:none; padding:12px; border-radius:8px; font-weight:bold; margin-bottom:10px; cursor:pointer;">📥 ПРОВЕРИТЬ И УСТАНОВИТЬ ВСЕ</button>
        <button id="radar-ignore-btn" class="action-btn" style="width:100%; background:#ef4444; color:#fff; border:none; padding:12px; border-radius:8px; font-weight:bold; margin-bottom:10px; cursor:pointer;">❌ ПРОПУСТИТЬ МУСОР (Больше не предлагать)</button>
        <button id="radar-close-btn" class="action-btn" style="width:100%; background:#475569; color:#fff; border:none; padding:12px; border-radius:8px; font-weight:bold; cursor:pointer;">СВЕРНУТЬ (Отложить)</button>
    `;
    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    document.getElementById('radar-close-btn').onclick = () => {
        overlay.remove();
    };

    document.getElementById('radar-ignore-btn').onclick = () => {
        let ignored = JSON.parse(localStorage.getItem('radar_ignored')) || [];
        files.forEach(f => ignored.push(f.name || f));
        localStorage.setItem('radar_ignored', JSON.stringify(ignored));
        overlay.remove();
    };

    document.getElementById('radar-install-btn').onclick = async () => {
        let installed = 0;
        let failed = 0;
        let processedFiles = []; 

        for (let i = 0; i < files.length; i++) {
            let fileName = files[i].name || files[i];
            processedFiles.push(fileName);

            modal.innerHTML = `
                <h3 style="color:#38bdf8; text-shadow: 0 2px 4px #000;">Анализ... ${i + 1}/${files.length}</h3>
                <p style="font-size:12px; color:#aaa;">${fileName}</p>
            `;
            
            try {
                const fileData = await Filesystem.readFile({
                    path: `Download/${fileName}`,
                    directory: Directory.ExternalStorage
                });
                
                let blob;
                if (fileData.data) {
                    const byteCharacters = atob(fileData.data);
                    const byteNumbers = new Array(byteCharacters.length);
                    for (let j = 0; j < byteCharacters.length; j++) {
                        byteNumbers[j] = byteCharacters.charCodeAt(j);
                    }
                    const byteArray = new Uint8Array(byteNumbers);
                    blob = new Blob([byteArray]);
                } else if (fileData.blob) {
                    blob = fileData.blob;
                } else {
                    throw new Error('Нет данных файла');
                }
                
                const fakeFile = new File([blob], fileName, { type: 'application/octet-stream' });
                
                await window.processSingleFile(fakeFile); 
                installed++;
            } catch (err) {
                console.error('Пропущен не-игровой файл:', fileName, err.message);
                failed++;
            }
        }
        
        let ignored = JSON.parse(localStorage.getItem('radar_ignored')) || [];
        ignored.push(...processedFiles);
        localStorage.setItem('radar_ignored', JSON.stringify(ignored));

        if (typeof renderAllGames === 'function') renderAllGames();

        modal.innerHTML = `
            <h3 style="margin-top:0; color:#10b981;">✅ АНАЛИЗ ЗАВЕРШЕН!</h3>
            <p style="font-size:13px; color:#94a3b8; margin-bottom:20px;">
                Успешно обработано архивов/игр: ${installed} шт.<br>
                ${failed > 0 ? `Отсеяно мусора (пустые архивы): ${failed} шт.<br><br>` : '<br>'}
                Игры добавлены в библиотеку эмулятора.
            </p>
            <button id="radar-close-final" class="action-btn" style="width:100%; background:#3b82f6; color:#fff; border:none; padding:12px; border-radius:8px; font-weight:bold; cursor:pointer;">ПОНЯТНО, ЗАКРЫТЬ</button>
        `;
        
        document.getElementById('radar-close-final').onclick = () => {
            overlay.remove();
        };
    };
}

// ==========================================
// УМНАЯ РАСПАКОВКА АРХИВОВ С РЕКУРСИЕЙ
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
    if (typeof window.processSingleFile === 'function') {
        const coreProcessSingleFile = window.processSingleFile;

        window.processSingleFileExtended = async function(file) {
            const fileName = file.name.toLowerCase();
            const validRomExts = ['.nes', '.md', '.sfc', '.smc', '.gen', '.bin', '.ngp', '.ngc'];
            const validDosExts = ['.exe', '.bat', '.com'];
            const validArchiveExts = ['.zip', '.rar', '.7z'];
            
            if ((fileName.endsWith('.rar') || fileName.endsWith('.7z')) && typeof Archive !== 'undefined') {
                const archive = await Archive.open(file);
                const extractedFiles = await archive.getFilesObject();
                
                let fileList = [];
                function flatten(obj, path = '') {
                    for (let key in obj) {
                        if (obj[key] instanceof File) {
                            fileList.push({ path: path + key, file: obj[key] });
                        } else {
                            flatten(obj[key], path + key + '/');
                        }
                    }
                }
                flatten(extractedFiles);

                let dosFiles = fileList.filter(f => validDosExts.some(ext => f.path.toLowerCase().endsWith(ext)));
                let romFiles = fileList.filter(f => validRomExts.some(ext => f.path.toLowerCase().endsWith(ext)));
                let nestedArchives = fileList.filter(f => validArchiveExts.some(ext => f.path.toLowerCase().endsWith(ext)));

                let hasValidContent = false;

                if (nestedArchives.length > 0) {
                    for (let f of nestedArchives) {
                        let cleanName = f.path.split('/').pop();
                        let newFile = new File([await readBlobSafe(f.file)], cleanName);
                        await window.processSingleFileExtended(newFile); 
                        await new Promise(r => setTimeout(r, 5)); 
                    }
                    hasValidContent = true;
                }

                if (romFiles.length > 0) {
                    for (let f of romFiles) {
                        let cleanName = f.path.split('/').pop();
                        let newFile = new File([await readBlobSafe(f.file)], cleanName);
                        await coreProcessSingleFile(newFile);
                        await new Promise(r => setTimeout(r, 5));
                    }
                    hasValidContent = true;
                }

                if (dosFiles.length > 0 && nestedArchives.length === 0) {
                    const zipData = {};
                    for(let f of fileList) {
                        zipData[f.path] = new Uint8Array(await readBlobSafe(f.file));
                    }
                    if (typeof fflate !== 'undefined') {
                        const zipped = fflate.zipSync(zipData);
                        const zipBlob = new Blob([zipped], {type: 'application/zip'});
                        const newZipFile = new File([zipBlob], file.name.replace(/\.(rar|7z)$/i, '.zip'), {type: 'application/zip'});
                        await coreProcessSingleFile(newZipFile);
                        hasValidContent = true;
                    }
                }

                if (!hasValidContent) throw new Error("Архив пуст или не содержит поддерживаемых игр");
                return;
            } 
            else if (fileName.endsWith('.zip')) {
                const buffer = await readBlobSafe(file);
                const arr = new Uint8Array(buffer);
                let unzipped;

                try {
                    unzipped = fflate.unzipSync(arr);
                } catch(e) { throw new Error("Ошибка чтения ZIP архива"); }

                let hasDos = false;
                let romFiles = [];
                let nestedArchives = [];

                for (const path in unzipped) {
                    const lowPath = path.toLowerCase();
                    if (validDosExts.some(ext => lowPath.endsWith(ext))) hasDos = true;
                    if (validRomExts.some(ext => lowPath.endsWith(ext))) {
                        romFiles.push({ path: path, data: unzipped[path] });
                    }
                    if (validArchiveExts.some(ext => lowPath.endsWith(ext))) {
                        nestedArchives.push({ path: path, data: unzipped[path] });
                    }
                }

                let hasValidContent = false;

                if (nestedArchives.length > 0) {
                    for (let arc of nestedArchives) {
                        let cleanName = arc.path.split('/').pop();
                        let blob = new Blob([arc.data]);
                        let newFile = new File([blob], cleanName);
                        await window.processSingleFileExtended(newFile);
                        await new Promise(r => setTimeout(r, 5));
                    }
                    hasValidContent = true;
                }

                if (romFiles.length > 0) {
                    for (let rom of romFiles) {
                        let cleanName = rom.path.split('/').pop();
                        let blob = new Blob([rom.data]);
                        let newFile = new File([blob], cleanName);
                        await coreProcessSingleFile(newFile);
                        await new Promise(r => setTimeout(r, 5)); 
                    }
                    hasValidContent = true;
                }

                if (hasDos && nestedArchives.length === 0 && romFiles.length === 0) {
                    await coreProcessSingleFile(file);
                    hasValidContent = true;
                }

                if (!hasValidContent) throw new Error("В ZIP архиве не найдено ROM или DOS-игр");
                return;
            }
            else {
                if (!validRomExts.some(ext => fileName.endsWith(ext))) {
                    throw new Error("Неизвестный формат файла");
                }
            }
            
            return await coreProcessSingleFile(file);
        };

        window.processSingleFile = window.processSingleFileExtended;
    }
});
