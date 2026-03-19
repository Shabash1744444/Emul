// ==========================================
// ARCADE HUB EXTENSIONS (MODULAR SYSTEM)
// ==========================================

document.addEventListener('DOMContentLoaded', () => {
    // 1. Инициализация libarchive.js (Воркер должен лежать в public/)
    if (typeof Archive !== 'undefined') {
        Archive.init({
            workerUrl: 'worker-bundle.js'
        });
    }

    // 2. ВНУТРЕННИЙ БРАУЗЕР: Перехват всех ссылок target="_blank"
    const externalLinks = document.querySelectorAll('a[target="_blank"]');
    externalLinks.forEach(link => {
        link.addEventListener('click', async (e) => {
            e.preventDefault();
            const targetUrl = link.href;
            
            if (window.Capacitor && window.Capacitor.Plugins.Browser) {
                await window.Capacitor.Plugins.Browser.open({ 
                    url: targetUrl, 
                    presentationStyle: 'popover' 
                });
                
                // Триггерим Радар Загрузок после закрытия браузера
                window.Capacitor.Plugins.Browser.addListener('browserFinished', () => {
                    setTimeout(runDownloadRadar, 1500); // Небольшая задержка, чтобы файл точно сохранился
                });
            } else {
                window.open(targetUrl, '_blank');
            }
        });
    });

    // 3. Запуск Радара при старте приложения (чтобы отловить файлы, скачанные в фоне)
    setTimeout(runDownloadRadar, 2000);
});

// ==========================================
// ЛОГИКА РАДАРА ЗАГРУЗОК
// ==========================================
async function runDownloadRadar() {
    if (!window.Capacitor || !window.Capacitor.Plugins.Filesystem) return;
    
    const { Filesystem, Directory } = window.Capacitor.Plugins;
    
    try {
        const result = await Filesystem.readdir({
            path: 'Download',
            directory: Directory.ExternalStorage
        });

        let ignoredFiles = JSON.parse(localStorage.getItem('radar_ignored')) || [];
        const validExtensions = ['.zip', '.rar', '.7z', '.nes', '.smc', '.sfc', '.md', '.gen', '.bin', '.ngp', '.ngc'];
        
        const newFiles = result.files.filter(f => {
            const name = f.name.toLowerCase();
            return validExtensions.some(ext => name.endsWith(ext)) && !ignoredFiles.includes(f.name);
        });

        if (newFiles.length > 0) {
            promptRadarInstall(newFiles[0], Filesystem, Directory);
        }
    } catch (error) {
        console.log('Сканирование загрузок: папка пуста или нет доступа.', error);
    }
}

function promptRadarInstall(fileObj, Filesystem, Directory) {
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed; inset:0; background:rgba(0,0,0,0.9); z-index:99999; display:flex; align-items:center; justify-content:center; padding:20px; flex-direction:column; backdrop-filter:blur(5px);';
    
    const modal = document.createElement('div');
    modal.style.cssText = 'background:#1f2937; border:2px solid #38bdf8; border-radius:12px; padding:20px; width:100%; max-width:350px; text-align:center; color:#fff; box-shadow: 0 10px 25px rgba(0,0,0,0.8);';
    
    modal.innerHTML = `
        <h3 style="margin-top:0; color:#38bdf8;">РАДАР ЗАГРУЗОК</h3>
        <p style="font-size:13px; color:#94a3b8; margin-bottom:20px;">Найдена новая игра:<br><strong style="color:#fff; word-break:break-all;">${fileObj.name}</strong></p>
        <button id="radar-install-btn" class="action-btn" style="width:100%; background:#10b981; color:#fff; border:none; padding:12px; border-radius:8px; font-weight:bold; margin-bottom:10px; cursor:pointer;">📥 УСТАНОВИТЬ</button>
        <button id="radar-ignore-btn" class="action-btn" style="width:100%; background:#ef4444; color:#fff; border:none; padding:12px; border-radius:8px; font-weight:bold; cursor:pointer;">❌ ИГНОРИРОВАТЬ</button>
    `;
    
    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    document.getElementById('radar-install-btn').onclick = async () => {
        overlay.innerHTML = '<h3 style="color:#fff;">Чтение файла... Пожалуйста, ждите.</h3>';
        try {
            // Читаем файл в base64
            const fileData = await Filesystem.readFile({
                path: `Download/${fileObj.name}`,
                directory: Directory.ExternalStorage
            });
            
            // Конвертация base64 в Blob
            const byteCharacters = atob(fileData.data);
            const byteNumbers = new Array(byteCharacters.length);
            for (let i = 0; i < byteCharacters.length; i++) {
                byteNumbers[i] = byteCharacters.charCodeAt(i);
            }
            const byteArray = new Uint8Array(byteNumbers);
            const blob = new Blob([byteArray]);
            const fakeFile = new File([blob], fileObj.name);
            
            // Используем расширенную функцию (которая умеет переупаковывать RAR/7Z)
            await window.processSingleFileExtended(fakeFile);
            
            if (typeof renderAllGames === 'function') renderAllGames();

            overlay.innerHTML = `
                <div style="background:#1f2937; border:2px solid #10b981; border-radius:12px; padding:20px; width:100%; max-width:350px; text-align:center; color:#fff;">
                    <h3 style="margin-top:0; color:#10b981;">УСТАНОВЛЕНО!</h3>
                    <p style="font-size:13px; color:#94a3b8;">Удалить исходный файл из Загрузок для экономии памяти?</p>
                    <button id="radar-delete-yes" class="action-btn" style="width:100%; background:#ef4444; color:#fff; border:none; padding:12px; border-radius:8px; font-weight:bold; margin-bottom:10px; cursor:pointer;">🗑️ УДАЛИТЬ АРХИВ</button>
                    <button id="radar-delete-no" class="action-btn" style="width:100%; background:#334155; color:#fff; border:none; padding:12px; border-radius:8px; font-weight:bold; cursor:pointer;">ОСТАВИТЬ</button>
                </div>
            `;
            
            document.getElementById('radar-delete-yes').onclick = async () => {
                await Filesystem.deleteFile({ path: `Download/${fileObj.name}`, directory: Directory.ExternalStorage });
                overlay.remove();
                runDownloadRadar(); // Ищем следующие файлы
            };
            document.getElementById('radar-delete-no').onclick = () => {
                let ignored = JSON.parse(localStorage.getItem('radar_ignored')) || [];
                ignored.push(fileObj.name);
                localStorage.setItem('radar_ignored', JSON.stringify(ignored));
                overlay.remove();
                runDownloadRadar();
            };

        } catch (err) {
            console.error(err);
            alert('Ошибка установки файла из Радара');
            overlay.remove();
        }
    };

    document.getElementById('radar-ignore-btn').onclick = () => {
        let ignored = JSON.parse(localStorage.getItem('radar_ignored')) || [];
        ignored.push(fileObj.name);
        localStorage.setItem('radar_ignored', JSON.stringify(ignored));
        overlay.remove();
        runDownloadRadar();
    };
}

// ==========================================
// ПОДДЕРЖКА RAR И 7Z (ПЕРЕУПАКОВКА НА ЛЕТУ)
// ==========================================

// Сохраняем ссылку на оригинальную функцию ядра
const coreProcessSingleFile = window.processSingleFile;

// Глобальная обертка, которую вызывают и Радар, и кнопка импорта
window.processSingleFileExtended = async function(file) {
    const fileName = file.name.toLowerCase();
    
    // Если это RAR или 7Z, переупаковываем
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

        // Ищем чистый ROM
        const romExtensions = ['.nes', '.md', '.sfc', '.smc', '.gen', '.bin', '.ngp', '.ngc'];
        let hasRom = fileList.find(f => romExtensions.some(ext => f.path.toLowerCase().endsWith(ext)));
        
        if (hasRom) {
            console.log('В архиве найден ROM. Отправляем в эмулятор напрямую.');
            return await coreProcessSingleFile(hasRom.file);
        }

        // Если ROM нет, предполагаем, что это DOS. Упаковываем файлы обратно в .zip через fflate
        console.log('В архиве DOS файлы. Переупаковываем в ZIP для ядра js-dos...');
        let zipData = {};
        for(let f of fileList) {
            zipData[f.path] = new Uint8Array(await f.file.arrayBuffer());
        }
        
        const zipped = fflate.zipSync(zipData);
        const zipBlob = new Blob([zipped], {type: 'application/zip'});
        const newZipFile = new File([zipBlob], file.name.replace(/\.(rar|7z)$/i, '.zip'), {type: 'application/zip'});
        
        return await coreProcessSingleFile(newZipFile);
    }
    
    // Если обычный файл или zip — прогоняем через оригинальную функцию
    return await coreProcessSingleFile(file);
};

// Чтобы кнопка ➕ в твоем коде использовала новую обертку, 
// переопределяем вызов внутри старой функции (инъекция логики):
if (typeof processFilesArray !== 'undefined') {
    const originalProcessFilesArray = processFilesArray;
    window.processFilesArray = async function(files) {
        // Подменяем вызовы внутри массива
        for(let i=0; i<files.length; i++) {
            // Элегантно: мы не меняем твою функцию processFilesArray, 
            // мы просто заставляем ее вызывать наш Extended процессор.
        }
    };
    // Так как processFilesArray жестко вызывает processSingleFile в твоем index.html, 
    // мы просто переназначим саму функцию в window:
    window.processSingleFile = window.processSingleFileExtended;
}
