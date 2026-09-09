import { StatusBar } from 'expo-status-bar';
import * as ImagePicker from 'expo-image-picker';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { extractExpense } from './src/services/ocr';
import { loadExpenses, saveExpenses } from './src/services/storage';
import type { Expense, ExpenseDraft } from './src/types/expense';

const emptyDraft: ExpenseDraft = {
  storeName: '', date: '', amount: '', category: 'その他', sourceType: 'receipt',
};

export default function App() {
  const [imageUri, setImageUri] = useState<string>();
  const [draft, setDraft] = useState<ExpenseDraft>(emptyDraft);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [processing, setProcessing] = useState(false);

  useEffect(() => { loadExpenses().then(setExpenses).catch(console.error); }, []);
  const total = useMemo(() => expenses.reduce((sum, item) => sum + Number(item.amount || 0), 0), [expenses]);

  const chooseImage = async (camera: boolean) => {
    const result = camera
      ? await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.9 })
      : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.9 });
    if (result.canceled) return;
    const uri = result.assets[0]?.uri;
    if (!uri) return;
    setImageUri(uri);
    setProcessing(true);
    try { setDraft(await extractExpense(uri)); }
    finally { setProcessing(false); }
  };

  const save = async () => {
    if (!draft.storeName.trim() || !draft.date || !draft.amount || Number(draft.amount) <= 0) {
      Alert.alert('確認してください', '店舗名、日付、0円より大きい金額を入力してください。');
      return;
    }
    const next = [{ ...draft, id: Date.now().toString(), imageUri }, ...expenses];
    await saveExpenses(next);
    setExpenses(next);
    setDraft(emptyDraft);
    setImageUri(undefined);
    Alert.alert('保存しました', '確認済みの支出を履歴に追加しました。');
  };

  const field = (label: string, key: keyof ExpenseDraft, keyboardType?: 'numeric') => (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        value={draft[key]}
        onChangeText={(value) => setDraft((current) => ({ ...current, [key]: value }))}
        keyboardType={keyboardType}
        style={styles.input}
      />
    </View>
  );

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar style="dark" />
      <ScrollView contentContainerStyle={styles.page}>
        <Text style={styles.eyebrow}>OCR EXPENSE TRACKER</Text>
        <Text style={styles.title}>ReceiptLog</Text>
        <Text style={styles.subtitle}>レシートも決済アプリの画面も、一つの支出履歴へ。</Text>

        <View style={styles.summary}>
          <Text style={styles.summaryLabel}>保存済み合計</Text>
          <Text style={styles.summaryValue}>¥{total.toLocaleString('ja-JP')}</Text>
          <Text style={styles.summaryMeta}>{expenses.length}件</Text>
        </View>

        <Text style={styles.sectionTitle}>1. 画像を選ぶ</Text>
        <View style={styles.row}>
          <ActionButton title="レシートを撮影" onPress={() => chooseImage(true)} />
          <ActionButton title="画像を選択" onPress={() => chooseImage(false)} secondary />
        </View>

        {imageUri && <Image source={{ uri: imageUri }} style={styles.preview} resizeMode="contain" />}
        {processing && <ActivityIndicator size="large" color="#0f766e" style={styles.loader} />}

        {(imageUri || draft.storeName) && !processing && (
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>2. 必ず確認・修正</Text>
            <Text style={styles.notice}>OCR・AIの結果は自動保存されません。</Text>
            {field('店舗名', 'storeName')}
            {field('日付（YYYY-MM-DD）', 'date')}
            {field('金額（円）', 'amount', 'numeric')}
            {field('カテゴリ', 'category')}
            <View style={styles.row}>
              <Choice active={draft.sourceType === 'receipt'} label="紙レシート" onPress={() => setDraft({ ...draft, sourceType: 'receipt' })} />
              <Choice active={draft.sourceType === 'payment_screenshot'} label="決済画面" onPress={() => setDraft({ ...draft, sourceType: 'payment_screenshot' })} />
            </View>
            <Pressable style={styles.saveButton} onPress={save}><Text style={styles.saveText}>確認して保存</Text></Pressable>
          </View>
        )}

        <Text style={styles.sectionTitle}>支出履歴</Text>
        {expenses.length === 0 ? <Text style={styles.empty}>まだ保存された支出はありません。</Text> : expenses.map((item) => (
          <View key={item.id} style={styles.expense}>
            <View><Text style={styles.expenseStore}>{item.storeName}</Text><Text style={styles.expenseMeta}>{item.date} · {item.category}</Text></View>
            <Text style={styles.expenseAmount}>¥{Number(item.amount).toLocaleString('ja-JP')}</Text>
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

function ActionButton({ title, onPress, secondary = false }: { title: string; onPress: () => void; secondary?: boolean }) {
  return <Pressable style={[styles.action, secondary && styles.actionSecondary]} onPress={onPress}><Text style={[styles.actionText, secondary && styles.actionTextSecondary]}>{title}</Text></Pressable>;
}

function Choice({ active, label, onPress }: { active: boolean; label: string; onPress: () => void }) {
  return <Pressable style={[styles.choice, active && styles.choiceActive]} onPress={onPress}><Text style={[styles.choiceText, active && styles.choiceTextActive]}>{label}</Text></Pressable>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#f4f7f5' }, page: { width: '100%', maxWidth: 680, alignSelf: 'center', padding: 22, paddingBottom: 60 },
  eyebrow: { color: '#0f766e', fontWeight: '800', letterSpacing: 2, fontSize: 12, marginTop: 20 }, title: { fontSize: 40, fontWeight: '900', color: '#132a26', marginTop: 4 },
  subtitle: { color: '#50635f', fontSize: 15, lineHeight: 23, marginBottom: 20 }, summary: { backgroundColor: '#123b35', borderRadius: 22, padding: 22, marginBottom: 26 },
  summaryLabel: { color: '#aad9ce', fontWeight: '700' }, summaryValue: { color: 'white', fontSize: 34, fontWeight: '900', marginTop: 6 }, summaryMeta: { color: '#aad9ce', marginTop: 2 },
  sectionTitle: { color: '#193b35', fontSize: 18, fontWeight: '800', marginBottom: 12, marginTop: 8 }, row: { flexDirection: 'row', gap: 10 }, action: { flex: 1, backgroundColor: '#0f766e', padding: 15, borderRadius: 14, alignItems: 'center' },
  actionSecondary: { backgroundColor: '#dceae6' }, actionText: { color: 'white', fontWeight: '800' }, actionTextSecondary: { color: '#0f665e' }, preview: { width: '100%', height: 220, marginTop: 16, backgroundColor: '#e5ebe8', borderRadius: 16 }, loader: { margin: 35 },
  card: { backgroundColor: 'white', padding: 18, borderRadius: 20, marginVertical: 22 }, notice: { color: '#9a4e19', backgroundColor: '#fff3e8', padding: 10, borderRadius: 10, marginBottom: 12 },
  field: { marginBottom: 12 }, label: { fontSize: 13, color: '#4a5d59', fontWeight: '700', marginBottom: 5 }, input: { backgroundColor: '#f3f6f5', borderWidth: 1, borderColor: '#dbe4e1', borderRadius: 11, padding: 12, fontSize: 16 },
  choice: { flex: 1, borderWidth: 1, borderColor: '#b9cbc6', padding: 12, borderRadius: 10, alignItems: 'center' }, choiceActive: { backgroundColor: '#daf2eb', borderColor: '#0f766e' }, choiceText: { color: '#63736f' }, choiceTextActive: { color: '#0f665e', fontWeight: '800' },
  saveButton: { backgroundColor: '#eb6b35', padding: 16, borderRadius: 13, alignItems: 'center', marginTop: 14 }, saveText: { color: 'white', fontWeight: '900', fontSize: 16 }, empty: { color: '#71807d', paddingVertical: 20 },
  expense: { backgroundColor: 'white', padding: 16, borderRadius: 14, marginBottom: 9, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, expenseStore: { color: '#1d342f', fontWeight: '800', fontSize: 16 }, expenseMeta: { color: '#71807d', marginTop: 4 }, expenseAmount: { color: '#173f38', fontWeight: '900', fontSize: 18 },
});
