import { SymbolView } from "expo-symbols";
import { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { core } from "../../state/core";
import { SenderAvatar } from "../home/SenderAvatar";
import { splitAddresses } from "../thread/reader";
import type { Palette } from "../theme";
import { emailOf, validRecipient } from "./compose";

type Contact = { name: string; email: string };

const format = (c: Contact) =>
  c.name ? `"${c.name.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}" <${c.email}>` : c.email;

const chipLabel = (token: string) =>
  token
    .replace(/<[^>]*>/, "")
    .replace(/^\s*"|"\s*$/g, "")
    .trim() || emailOf(token);

/**
 * the Swift app's RecipientField: who it's to as chips (an × each, red when not
 * an address), a field to type more (a comma, semicolon or return makes a
 * chip), and the people you've written with as you type (core's contacts).
 */
export function RecipientField({
  label,
  value,
  onChange,
  accountId,
  excluded,
  colors,
  autoFocus = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  accountId: string;
  /** Already a recipient (in any field): not suggested again. */
  excluded: ReadonlySet<string>;
  colors: Palette;
  autoFocus?: boolean;
}) {
  const [chips, setChips] = useState(() => splitAddresses(value));
  const [entry, setEntry] = useState("");
  const [focused, setFocused] = useState(false);
  const [suggestions, setSuggestions] = useState<Contact[]>([]);
  const published = useRef(value);

  // A value set from outside (a reply's recipients arriving): take it.
  useEffect(() => {
    if (value === published.current) return;
    published.current = value;
    setChips(splitAddresses(value));
    setEntry("");
  }, [value]);

  const publish = (nextChips: string[], nextEntry: string) => {
    const joined = [...nextChips, ...(nextEntry.trim() ? [nextEntry.trim()] : [])].join(", ");
    published.current = joined;
    onChange(joined);
  };

  const commit = (text = entry) => {
    const have = new Set(chips.map((c) => emailOf(c).toLowerCase()));
    const added = splitAddresses(text).filter((t) => !have.has(emailOf(t).toLowerCase()));
    const next = [...chips, ...added];
    setChips(next);
    setEntry("");
    setSuggestions([]);
    publish(next, "");
  };

  useEffect(() => {
    const q = entry.trim();
    if (!focused || q.length < 1) return setSuggestions([]);
    let current = true;
    void core
      .invoke<Contact[]>("gmail:suggestContacts", { q, limit: 6, accountId })
      .then((found) => {
        if (current)
          setSuggestions(found.filter((c) => !excluded.has(c.email.toLowerCase())).slice(0, 5));
      })
      .catch(() => {});
    return () => {
      current = false;
    };
  }, [entry, focused, accountId, excluded]);

  return (
    <View style={[styles.field, { borderColor: colors.border }]}>
      <View style={styles.row}>
        <Text style={[styles.label, { color: colors.secondary }]}>{label}</Text>
        <View style={styles.chips}>
          {chips.map((token, index) => (
            <View
              key={`${token}:${index}`}
              style={[styles.chip, { backgroundColor: colors.surface, borderColor: colors.border }]}
              accessible
              accessibilityLabel={token}
            >
              <Text
                style={[
                  styles.chipText,
                  { color: validRecipient(token) ? colors.text : colors.error },
                ]}
                numberOfLines={1}
              >
                {chipLabel(token)}
              </Text>
              <Pressable
                onPress={() => {
                  const next = chips.filter((_, i) => i !== index);
                  setChips(next);
                  publish(next, entry);
                }}
                hitSlop={8}
                accessibilityLabel={`Remove ${token}`}
              >
                <SymbolView name="xmark" size={10} weight="bold" tintColor={colors.secondary} />
              </Pressable>
            </View>
          ))}
          <TextInput
            value={entry}
            onChangeText={(text) => {
              const quotes = (text.match(/"/g) ?? []).length;
              if (/[,;\n]$/.test(text) && quotes % 2 === 0) commit(text.slice(0, -1));
              else {
                setEntry(text);
                publish(chips, text);
              }
            }}
            onSubmitEditing={() => commit()}
            onFocus={() => setFocused(true)}
            onBlur={() => {
              setFocused(false);
              if (entry.trim()) commit();
            }}
            submitBehavior="submit"
            returnKeyType="done"
            placeholder={chips.length ? "" : "Add recipient"}
            placeholderTextColor={colors.secondary}
            style={[styles.input, { color: colors.text }]}
            keyboardType="email-address"
            textContentType="emailAddress"
            autoCapitalize="none"
            autoCorrect={false}
            autoFocus={autoFocus}
            accessibilityLabel={label}
            testID={`compose-${label.toLowerCase()}`}
          />
        </View>
      </View>
      {suggestions.map((contact) => (
        <Pressable
          key={contact.email}
          onPress={() => commit(format(contact))}
          style={styles.suggestion}
          accessibilityRole="button"
          accessibilityLabel={`Add ${contact.name || contact.email}`}
        >
          <SenderAvatar accountId={accountId} email={contact.email} name={contact.name} size={30} />
          <View style={styles.suggestionText}>
            <Text style={{ color: colors.text, fontSize: 15 }} numberOfLines={1}>
              {contact.name || contact.email}
            </Text>
            {contact.name ? (
              <Text style={{ color: colors.secondary, fontSize: 12 }} numberOfLines={1}>
                {contact.email}
              </Text>
            ) : null}
          </View>
          <SymbolView name="plus" size={14} tintColor={colors.secondary} />
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  field: { borderBottomWidth: StyleSheet.hairlineWidth, marginHorizontal: 20, paddingVertical: 4 },
  row: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  label: { fontSize: 15, width: 44, paddingTop: 11 },
  chips: { flex: 1, flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6 },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    maxWidth: "100%",
  },
  chipText: { fontSize: 15, flexShrink: 1 },
  input: { flexGrow: 1, minWidth: 120, fontSize: 16, minHeight: 40 },
  suggestion: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 6 },
  suggestionText: { flex: 1, gap: 2 },
});
