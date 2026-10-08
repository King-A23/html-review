/* Read-only associations with user-selected local files. Never exported in review copies. */
(function (global) {
  'use strict';
  const paths = new WeakMap();
  function path(file) {
    if (paths.has(file)) return paths.get(file);
    const value = (file.webkitRelativePath || file.name).replace(/\\/g, '/');
    return file.webkitRelativePath ? value.split('/').slice(1).join('/') : value;
  }
  function valid(access) {
    if (!access || typeof access !== 'object') return null;
    const file = access.fileHandle;
    const directory = access.directoryHandle;
    if (file && (file.kind !== 'file' || typeof file.getFile !== 'function')) return null;
    if (directory && (directory.kind !== 'directory' || typeof directory.getFileHandle !== 'function')) return null;
    if (!file && !directory) return null;
    if (directory && (typeof access.entryPath !== 'string' || !access.entryPath || /(^|\/)\.\.?($|\/)|^\/|\\/.test(access.entryPath))) return null;
    return access;
  }
  async function permission(handle) {
    if (typeof handle.queryPermission !== 'function') return;
    if (await handle.queryPermission({mode: 'read'}) === 'granted') return;
    if (await handle.requestPermission({mode: 'read'}) !== 'granted') {
      throw new Error('未获得读取权限，当前页面、批注和草稿已保留。再次重载时可重新授权。');
    }
  }
  async function directoryFiles(handle) {
    const files = [];
    let bytes = 0;
    async function visit(directory, prefix) {
      for await (const [name, child] of directory.entries()) {
        const relative = prefix + name;
        if (child.kind === 'directory') await visit(child, relative + '/');
        else {
          const file = await child.getFile();
          bytes += file.size;
          if (files.length >= 500 || bytes > 50 * 1024 * 1024) throw new Error('文件夹最多 500 个文件、合计最多 50 MiB。请选择只包含页面所需资源的目录。');
          paths.set(file, relative);
          files.push(file);
        }
      }
    }
    await visit(handle, '');
    return files;
  }
  global.HRLocalFiles = Object.freeze({
    path, valid, permission, directoryFiles,
    canPickFile: () => typeof global.showOpenFilePicker === 'function',
    canPickDirectory: () => typeof global.showDirectoryPicker === 'function',
    pickFile: () => global.showOpenFilePicker({id: 'html-review-source', multiple: false,
      types: [{description: 'HTML / DOCX / PDF 文档或批注', accept: {'text/html': ['.html', '.htm', '.xhtml'], 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':['.docx'],'application/pdf':['.pdf'],'application/json':['.json']}}]}),
    pickDirectory: () => global.showDirectoryPicker({id: 'html-review-resources', mode: 'read'})
  });
})(window);
