const fs = require('fs');
let lines = fs.readFileSync('public/index.html', 'utf8').split('\n');

// The structure currently (0-indexed, but line numbers above are 1-indexed so subtract 1):
// Line 248 (idx 247): "               </div>\r" — closes voice-channels-list div
// Line 249 (idx 248): "            </div>\r" — closes sidebar-scrollable div 
// Line 250 (idx 249): "\r" — blank
// Line 251 (idx 250): "            <!-- ALT KONTROL PANELİ -->\r"
// Line 252 (idx 251): "            <div class="user-bottom-panel" id="user-bottom-panel">\r"
// ...
// Line 311 (idx 310): "            </div>\r" — closes user-bottom-panel
// Line 312 (idx 311): "\r"
// Line 313 (idx 312): "         </div>\r" — closes server-sidebar-content
// Line 314 (idx 313): "      </div>\r" — closes .sidebar
// Line 315 (idx 314): "\r"
// Line 316 (idx 315): "         <!-- ARKADAŞ LOBİSİ GÖRÜNÜMÜ -->"
// Line 317 (idx 316): "         <div id="friends-lobby-view"...>"
// ...
// Line 410 (idx 409): "         </div>\r" — closes .right-sidebar
// Line 411 (idx 410): "\r"
// Line 412 (idx 411): "      <div id="video-modal"..." — WRONG: video-modal opened INSIDE app-container

// Fix 1: Insert a closing </div> for server-sidebar-content before user-bottom-panel
// We need to close server-sidebar-content after the scrollable div closes (at idx 248)
// and before the user-bottom-panel (at idx 250)
// Insert "         </div>\r" at idx 249 (before the blank line)
lines.splice(249, 0, '         </div>\r');
console.log('Fix1: Inserted closing server-sidebar-content');

// Now line numbers shift by 1 after idx 249.
// Fix 2: Remove the extra closing </div> for server-sidebar-content (was at idx 312, now at idx 313)
// After the shift, user-bottom-panel closes at idx 311 (was 310), then blank at idx 312,
// then the now-redundant server-sidebar-content close is at idx 313
// Line 314 (idx 313 after fix1) was: "         </div>\r" - this was server-sidebar-content closing
// We need to remove it since we already added it above.
// Let's find and remove the pattern:
// idx 312: blank line "\r"
// idx 313: "         </div>\r" (redundant - was closing server-sidebar-content)
// idx 314: "      </div>\r" (closing .sidebar)
// We want: idx 312: blank, idx 313: "      </div>\r" (closing .sidebar)
if (lines[313] && lines[313].trim() === '</div>') {
    lines.splice(313, 1);
    console.log('Fix2: Removed redundant server-sidebar-content closing');
} else {
    console.log('Fix2: Pattern not found at idx 313, content:', JSON.stringify(lines[313]));
}

// Fix 3: Add app-container closing after right-sidebar closing (before video-modal)
// After Fix2, right-sidebar closes at approximately idx 409
// Find the video-modal opening and insert app-container close before it
for (let i = 400; i < 420; i++) {
    if (lines[i] && lines[i].includes('id="video-modal"')) {
        lines.splice(i, 0, '   </div>\r');
        console.log('Fix3: Inserted app-container closing before video-modal at idx', i);
        break;
    }
}

// Also fix "Voice Connected" text
for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes('Voice Connected')) {
        lines[i] = lines[i].replace('Voice Connected', 'Sese Bağlandı');
        console.log('Fixed Voice Connected at line', i);
    }
}

fs.writeFileSync('public/index.html', lines.join('\n'), 'utf8');
console.log('Done! Total lines:', lines.length);
