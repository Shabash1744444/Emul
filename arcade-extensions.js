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

    setTimeout(runDownloadRadar, 2000);
});

async function runDownloadRadar(manualTrigger = false) {
    if (!Capacitor.isNativePlatform()) {
        console.log('Радар: Работаем в браузере, сканер отключен.');
        if (manualTrigger) alert('📡 Радар работает только в скомпилированном APK');
        return;
    }
    
    try {
        await Filesystem.requestPermissions();
        
        let result;
        try {
            result = await Filesystem.readdir({
                path: 'Download',
                directory: Directory.ExternalStorage
            });
        } catch (e) {
            console.error('Радар: Ошибка чтения папки Download:', e);
            if (!localStorage.getItem('radar_alert_shown') || manualTrigger) {
                alert('📡 РАДАРУ НУЖНЫ ПРАВА!\n\nЧтобы эмулятор сам устанавливал игры, зайдите в:\nНастройки -> Приложения -> Arcade Hub -> Разрешения -> "Доступ ко всем файлам".');
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
            promptRadarInstall(newFiles[0]);
        } else {
            if (manualTrigger) alert('✅ Новых игр в Загрузках не найдено!');
        }
    } catch (error) {
        console.error('Радар: Критическая ошибка:', error);
    }
}

window.runDownloadRadar = runDownloadRadar;

function promptRadarInstall(fileObj) {
    const fileName = fileObj.name || fileObj; 
    
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed; inset:0; background:rgba(0,0,0,0.9); z-index:99999; display:flex; align-items:center; justify-content:center; padding:20px; flex-direction:column; backdrop-filter:blur(5px);';
    
    const modal = document.createElement('div');
    modal.style.cssText = 'background:#1f2937; border:2px solid #38bdf8; border-radius:12px; padding:20px; width:100%; max-width:350px; text-align:center; color:#fff; box-shadow: 0 10px 25px rgba(0,0,0,0.8);';
    
    modal.innerHTML = `
        <h3 style="margin-top:0; color:#38bdf8;">РАДАР ЗАГРУЗОК 📡</h3>
        <p style="font-size:13px; color:#94a3b8; margin-bottom:20px;">Найдена новая скачанная игра:<br><strong style="color:#fff; word-break:break-all;">${fileName}</strong></p>
        <button id="radar-install-btn" class="action-btn" style="width:100%; background:#10b981; color:#fff; border:none; padding:12px; border-radius:8px; font-weight:bold; margin-bottom:10px; cursor:pointer;">📥 УСТАНОВИТЬ В ЭМУЛЯТОР</button>
        <button id="radar-ignore-btn" class="action-btn" style="width:100%; background:#ef4444; color:#fff; border:none; padding:12px; border-radius:8px; font-weight:bold; cursor:pointer;">❌ ПРОПУСТИТЬ</button>
    `;
    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    document.getElementById('radar-ignore-btn').onclick = () => {
        let ignored = JSON.parse(localStorage.getItem('radar_ignored')) || [];
        ignored.push(fileName);
        localStorage.setItem('radar_ignored', JSON.stringify(ignored));
        overlay.remove();
        runDownloadRadar();
    };

    document.getElementById('radar-install-btn').onclick = async () => {
        modal.innerHTML = '<h3 style="color:#38bdf8; text-shadow: 0 2px 4px #000;">Чтение архива... Ждите ⏳</h3>';
        try {
            const fileData = await Filesystem.readFile({
                path: `Download/${fileName}`,
                directory: Directory.ExternalStorage
            });
            
            let blob;
            if (fileData.data) {
                const byteCharacters = atob(fileData.data);
                const byteNumbers = new Array(byteCharacters.length);
                for (let i = 0; i < byteCharacters.length; i++) {
                    byteNumbers[i] = byteCharacters.charCodeAt(i);
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
            
            if (typeof renderAllGames === 'function') renderAllGames();

            modal.innerHTML = `
                <h3 style="margin-top:0; color:#10b981;">✅ УСТАНОВЛЕНО!</h3>
                <p style="font-size:13px; color:#94a3b8; margin-bottom:20px;">Игра сохранена во внутреннюю базу эмулятора.<br>Удалить исходный файл из "Загрузок"?</p>
                <button id="radar-delete-yes" class="action-btn" style="width:100%; background:#ef4444; color:#fff; border:none; padding:12px; border-radius:8px; font-weight:bold; margin-bottom:10px; cursor:pointer;">🗑️ ДА, УДАЛИТЬ ИСХОДНИК</button>
                <button id="radar-delete-no" class="action-btn" style="width:100%; background:#334155; color:#fff; border:none; padding:12px; border-radius:8px; font-weight:bold; cursor:pointer;">ОСТАВИТЬ</button>
            `;
            
            document.getElementById('radar-delete-yes').onclick = async () => {
                await Filesystem.deleteFile({ path: `Download/${fileName}`, directory: Directory.ExternalStorage });
                overlay.remove();
                runDownloadRadar();
            };
            
            document.getElementById('radar-delete-no').onclick = () => {
                let ignored = JSON.parse(localStorage.getItem('radar_ignored')) || [];
                ignored.push(fileName);
                localStorage.setItem('radar_ignored', JSON.stringify(ignored));
                overlay.remove();
                runDownloadRadar();
            };

        } catch (err) {
            console.error(err);
            alert('Ошибка при установке файла. Возможно, архив поврежден.');
            overlay.remove();
        }
    };
}

document.addEventListener('DOMContentLoaded', () => {
    if (typeof window.processSingleFile === 'function') {
        const coreProcessSingleFile = window.processSingleFile;

        window.processSingleFileExtended = async function(file) {
            const fileName = file.name.toLowerCase();
            
            if ((fileName.endsWith('.rar') || fileName.endsWith('.7z')) && typeof Archive !== 'undefined') {
                console.log('Обнаружен архив RAR/7Z. Начинаем распаковку в RAM...');
                
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

                const romExtensions = ['.nes', '.md', '.sfc', '.smc', '.gen', '.bin', '.ngp', '.ngc'];
                let hasRom = fileList.find(f => romExtensions.some(ext => f.path.toLowerCase().endsWith(ext)));
                
                if (hasRom) {
                    return await coreProcessSingleFile(hasRom.file);
                }

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
            
            return await coreProcessSingleFile(file);
        };

        window.processSingleFile = window.processSingleFileExtended;
    }
});
