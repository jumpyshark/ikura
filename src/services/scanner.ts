import DocumentScanner from 'react-native-document-scanner-plugin';

export async function scanReceipt(): Promise<string | undefined> {
  const result = await DocumentScanner.scanDocument({ croppedImageQuality: 100, maxNumDocuments: 1 });
  if (result.status === 'cancel') return undefined;
  const images = result.scannedImages ?? [];
  // iOS does not support the page limit. Never silently discard extra pages.
  if (images.length > 1) throw new Error('1回につき1枚のレシートを撮影してください。');
  return images[0];
}
