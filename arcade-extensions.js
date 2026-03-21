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
                    presentationStyle: 'popover',
                    toolbarColor: '#1f2937' // <-- Верхняя панель с кнопкой "Закрыть"
                });
                
                // Триггерим Радар Загрузок после закрытия браузера
                window.Capacitor.Plugins.Browser.addListener('browserFinished', () => {
                    setTimeout(runDownloadRadar, 1500); // Задержка, чтобы файл точно скачался
                });
            } else {
                window.open(targetUrl, '_blank');
            }
        });
    });

    // 3. Запуск Радара при старте приложения
    setTimeout(runDownloadRadar, 2000);
});

// ==========================================
// ЛОГИКА РАДАРА (АВТО-УСТАНОВКА И УДАЛЕНИЕ)
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
            const name = f.name ? f.name.toLowerCase() : f.toLowerCase(); 
            const fileName = f.name || f;
            return validExtensions.some(ext => name.endsWith(ext)) && !ignoredFiles.includes(fileName);
        });

        if (newFiles.length > 0) {
            promptRadarInstall(newFiles[0], Filesystem, Directory);
        }
    } catch (error) {
        console.log('Радар: Папка загрузок пуста или нет прав доступа.', error);
    }
}

function promptRadarInstall(fileObj, Filesystem, Directory) {
    const fileName = fileObj.name || fileObj; 
    
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed; inset:0; background:rgba(0,0,0,0.9); z-index:99999; display:flex; align-items:center; justify-content:center; padding:20px; flex-direction:column; backdrop-filter:blur(5px);';
    
    // ЭТАП 1: Предложение установить
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
            
            const byteCharacters = atob(fileData.data);
            const byteNumbers = new Array(byteCharacters.length);
            for (let i = 0; i < byteCharacters.length; i++) {
                byteNumbers[i] = byteCharacters.charCodeAt(i);
            }
            const byteArray = new Uint8Array(byteNumbers);
            const blob = new Blob([byteArray]);
            const fakeFile = new File([blob], fileName);
            
            // Вызываем нашу расширенную функцию (которая умеет распаковывать rar/7z)
            await window.processSingleFile(fakeFile); 
            
            if (typeof renderAllGames === 'function') renderAllGames();

            // ЭТАП 2: Успех и предложение удалить исходник
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

// ==========================================
// ПОДДЕРЖКА RAR И 7Z (ПЕРЕУПАКОВКА НА ЛЕТУ)
// ==========================================

// Ждем загрузки основного index.html, чтобы перехватить processSingleFile
document.addEventListener('DOMContentLoaded', () => {
    if (typeof window.processSingleFile === 'function') {
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
                
                if (typeof fflate !== 'undefined') {
                    const zipped = fflate.zipSync(zipData);
                    const zipBlob = new Blob([zipped], {type: 'application/zip'});
                    const newZipFile = new File([zipBlob], file.name.replace(/\.(rar|7z)$/i, '.zip'), {type: 'application/zip'});
                    return await coreProcessSingleFile(newZipFile);
                }
            }
            
            // Если обычный файл или zip — прогоняем через оригинальную функцию
            return await coreProcessSingleFile(file);
        };

        // Подменяем оригинальную функцию нашей расширенной
        window.processSingleFile = window.processSingleFileExtended;
    }
});
