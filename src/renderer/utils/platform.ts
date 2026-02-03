/**
 * Platform detection utilities
 * Helps differentiate between Electron, Web, and Capacitor environments
 */

export const isElectron = () => {
  // Check if running in Electron
  return typeof window !== 'undefined' && 
    window.process?.type === 'renderer';
};

export const isCapacitor = () => {
  // Check if running in Capacitor
  return typeof (window as any)?.Capacitor !== 'undefined';
};

export const isAndroid = () => {
  return isCapacitor() && (window as any).Capacitor.getPlatform() === 'android';
};

export const isIOS = () => {
  return isCapacitor() && (window as any).Capacitor.getPlatform() === 'ios';
};

export const isMobile = () => {
  return isAndroid() || isIOS() || /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
};

export const isWeb = () => {
  return !isElectron() && !isCapacitor();
};

/**
 * Get the appropriate API for file operations
 * Uses Capacitor Filesystem API on mobile, falls back to other methods on web
 */
export const getFileSystemAPI = () => {
  if (isCapacitor()) {
    // Dynamically import Capacitor Filesystem plugin
    return import('@capacitor/filesystem').then(m => m.Filesystem);
  }
  return null;
};

/**
 * Show native file picker
 */
export const showFilePicker = async (options?: { accept?: string; multiple?: boolean }): Promise<File[] | null> => {
  if (isCapacitor()) {
    // Use Capacitor FilePicker plugin if available
    try {
      const { FilePicker } = await import('@capawesome/capacitor-file-picker');
      const result = await FilePicker.pickFiles({
        types: options?.accept ? [options.accept] : undefined,
        multiple: options?.multiple ?? false,
      });
      return result.files.map(f => new File([f.blob || ''], f.name));
    } catch {
      // Fallback
    }
  }
  
  // Web fallback using input element
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    if (options?.accept) input.accept = options.accept;
    if (options?.multiple) input.multiple = true;
    input.onchange = () => {
      resolve(input.files ? Array.from(input.files) : null);
    };
    input.click();
  });
};

/**
 * Share content using native share sheet
 */
export const shareContent = async (options: { title?: string; text?: string; url?: string; files?: File[] }) => {
  if (isCapacitor()) {
    const { Share } = await import('@capacitor/share');
    await Share.share({
      title: options.title,
      text: options.text,
      url: options.url,
    });
  } else if (navigator.share) {
    // Web Share API
    await navigator.share({
      title: options.title,
      text: options.text,
      url: options.url,
    });
  } else {
    // Fallback - copy to clipboard
    if (options.url) {
      navigator.clipboard.writeText(options.url);
      alert('链接已复制到剪贴板');
    }
  }
};
