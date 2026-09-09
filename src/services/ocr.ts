import { Platform } from 'react-native';
import { extractTextFromImage, isSupported, TextRecognitionScript } from '@zhanziyang/expo-text-extractor';
import { parseReceiptText } from './parser';

export async function extractExpense(imageUri: string) {
  if (Platform.OS === 'web') throw new Error('OCRはAndroid/iOSのdevelopment buildで利用できます。');
  if (!isSupported) throw new Error('この端末ではOCRを利用できません。');
  const lines = await extractTextFromImage(imageUri, { script: TextRecognitionScript.JAPANESE, languages: ['ja-JP', 'en-US'] });
  return parseReceiptText(lines);
}
