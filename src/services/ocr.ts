import { Platform } from 'react-native';
import { extractTextFromImage, isSupported, TextRecognitionScript, RecognitionLevel } from '@zhanziyang/expo-text-extractor';
import { parseReceiptText } from './parser';

export async function extractExpense(imageUri: string) {
  if (Platform.OS === 'web') throw new Error('OCRはAndroid/iOSのdevelopment buildで利用できます。');
  if (!isSupported) throw new Error('この端末ではOCRを利用できません。');
  const lines = await extractTextFromImage(imageUri, { script: TextRecognitionScript.JAPANESE, languages: ['ja-JP', 'en-US'], recognitionLevel: RecognitionLevel.ACCURATE, minimumTextHeight: 0.005, usesLanguageCorrection: true });
  if (!lines.some(line => line.trim())) throw new Error('文字を読み取れませんでした。明るい場所で画像を近づけ、もう一度撮影してください。');
  return parseReceiptText(lines);
}
