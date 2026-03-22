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

    // Запускаем 1 раз при старте
    setTimeout(runDownloadRadar, 2000);
});

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
    
    if (manualTrigger) await requestStoragePermission();
    
    const Filesystem = window.NativeFilesystem;
    const Directory = window.NativeDirectory;
    
    try {
        let result;
        try {
            result = await Filesystem.readdir({
                path: 'Download',
                directory: Directory.ExternalStorage
            });
        } catch (e) {
            console.error('Радар: Ошибка чтения папки Download:', e);
            if (!localStorage.getItem('radar_alert_shown') || manualTrigger) {
                alert('📡 РАДАРУ НУЖНЫ ПРАВА!\n\nЧтобы эмулятор сам устанавливал игры, зайдите в:\nНастройки -> Приложения -> Arcade Hub -> Разрешения -> "Доступ ко всем файлам" (или "Файлы и медиаконтент").');
                localStorage.setItem('radar_alert_shown', 'true');
            }
            return;
        }
        
        if (!result || !Array.isArray(result.files)) return;

        let ignoredFiles = JSON.parse(localStorage.getItem('radar_ignored')) || [];
        const validExtensions = ['.zip', '.rar', '.7z', '.nes', '.smc', '.sfc', '.md', '.gen', '.bin', '.ngp', '.ngc'];
        
        const newFiles = result.files.filter(f => {
            const fileName = (f.name || f).toLowerCase(); 
            return validExtensions.some(ext => fileName.endsWith(ext)) && !ignoredFiles.includes(f.name || f);
        });

        if (newFiles.length > 0) {
            promptRadarInstall(newFiles, Filesystem, Directory);
        } else {
            if (manualTrigger) alert('✅ Новых игр (и архивов) в Загрузках не найдено!');
        }
    } catch (error) {
        console.error('Радар: Критическая ошибка:', error);
    }
}

window.runDownloadRadar = runDownloadRadar;

function promptRadarInstall(files, Filesystem, Directory) {
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

    // Просто закрывает окно, файлы останутся "новыми" для следующего сканирования
    document.getElementById('radar-close-btn').onclick = () => {
        overlay.remove();
    };

    // Заносит все файлы в черный список, больше они не появятся
    document.getElementById('radar-ignore-btn').onclick = () => {
        let ignored = JSON.parse(localStorage.getItem('radar_ignored')) || [];
        files.forEach(f => ignored.push(f.name || f));
        localStorage.setItem('radar_ignored', JSON.stringify(ignored));
        overlay.remove();
    };

    document.getElementById('radar-install-btn').onclick = async () => {
        let installed = 0;
        let failed = 0;
        let toDelete = []; // Для успешных (чтобы удалить исходник)
        let processedFiles = []; // Для ВСЕХ (чтобы добавить в игнор-лист)

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
                
                // Вызов умного обработчика, который выкинет мусор
                await window.processSingleFile(fakeFile); 
                
                installed++;
                toDelete.push(fileName);
            } catch (err) {
                console.error('Пропущен не-игровой файл:', fileName, err.message);
                failed++;
            }
        }
        
        // ВАЖНО: Добавляем ВСЕ просканированные файлы (даже мусор) в игнор, чтобы радар не зациклился
        let ignored = JSON.parse(localStorage.getItem('radar_ignored')) || [];
        ignored.push(...processedFiles);
        localStorage.setItem('radar_ignored', JSON.stringify(ignored));

        if (typeof renderAllGames === 'function') renderAllGames();

        modal.innerHTML = `
            <h3 style="margin-top:0; color:#10b981;">✅ АНАЛИЗ ЗАВЕРШЕН!</h3>
            <p style="font-size:13px; color:#94a3b8; margin-bottom:20px;">
                Успешно установлено игр: ${installed} шт.<br>
                ${failed > 0 ? `Отсеяно мусора (не игры): ${failed} шт.<br><br>` : '<br>'}
                Игры сохранены во внутреннюю базу.<br>Удалить установленные архивы из папки "Загрузки", чтобы не занимали место?
            </p>
            <button id="radar-delete-yes" class="action-btn" style="width:100%; background:#ef4444; color:#fff; border:none; padding:12px; border-radius:8px; font-weight:bold; margin-bottom:10px; cursor:pointer; display: ${installed > 0 ? 'block' : 'none'};">🗑️ ДА, ОЧИСТИТЬ ПАМЯТЬ</button>
            <button id="radar-delete-no" class="action-btn" style="width:100%; background:#334155; color:#fff; border:none; padding:12px; border-radius:8px; font-weight:bold; cursor:pointer;">ЗАКРЫТЬ</button>
        `;
        
        document.getElementById('radar-delete-yes').onclick = async () => {
            modal.innerHTML = '<h3 style="color:#ef4444;">Удаление...</h3>';
            for (let f of toDelete) {
                try {
                    await Filesystem.deleteFile({ path: `Download/${f}`, directory: Directory.ExternalStorage });
                } catch(e) {}
            }
            overlay.remove();
        };
        
        document.getElementById('radar-delete-no').onclick = () => {
            overlay.remove();
        };
    };
}

document.addEventListener('DOMContentLoaded', () => {
    if (typeof window.processSingleFile === 'function') {
        const coreProcessSingleFile = window.processSingleFile;

        // УМНАЯ ОБЕРТКА (Смотрит внутрь архивов и выкидывает мусор)
        window.processSingleFileExtended = async function(file) {
            const fileName = file.name.toLowerCase();
            const validRomExts = ['.nes', '.md', '.sfc', '.smc', '.gen', '.bin', '.ngp', '.ngc'];
            const validDosExts = ['.exe', '.bat', '.com'];
            
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

                let hasRom = fileList.find(f => validRomExts.some(ext => f.path.toLowerCase().endsWith(ext)));
                if (hasRom) return await coreProcessSingleFile(hasRom.file);

                let hasDos = fileList.find(f => validDosExts.some(ext => f.path.toLowerCase().endsWith(ext)));
                if (!hasRom && !hasDos) throw new Error("Архив пуст или не содержит игр");

                const zipData = {};
                for(let f of fileList) {
                    zipData[f.path] = new Uint8Array(await readBlobSafe(f.file));
                }
                
                if (typeof fflate !== 'undefined') {
                    const zipped = fflate.zipSync(zipData);
                    const zipBlob = new Blob([zipped], {type: 'application/zip'});
                    const newZipFile = new File([zipBlob], file.name.replace(/\.(rar|7z)$/i, '.zip'), {type: 'application/zip'});
                    return await coreProcessSingleFile(newZipFile);
                }
            } 
            else if (fileName.endsWith('.zip')) {
                const buffer = await readBlobSafe(file);
                const arr = new Uint8Array(buffer);
                let isValid = false;

                try {
                    // Быстрый поиск нужных расширений внутри zip без полной распаковки
                    const unzipped = fflate.unzipSync(arr);
                    for (const path in unzipped) {
                        const lowPath = path.toLowerCase();
                        if (validRomExts.some(ext => lowPath.endsWith(ext)) || validDosExts.some(ext => lowPath.endsWith(ext))) {
                            isValid = true;
                            break;
                        }
                    }
                } catch(e) { console.error("Ошибка чтения ZIP:", e); }

                if (!isValid) throw new Error("В ZIP архиве не найдено ROM или DOS-игр");
            }
            else {
                // Если это просто отдельный файл, проверяем, что это игра
                if (!validRomExts.some(ext => fileName.endsWith(ext)) && !fileName.endsWith('.html')) {
                    throw new Error("Неизвестный формат файла");
                }
            }
            
            return await coreProcessSingleFile(file);
        };

        window.processSingleFile = window.processSingleFileExtended;
    }
});
