// Text that clamps to N lines with a "Show more"/"Show less" toggle, shown only
// when the text actually overflows. Overflow is detected by measuring the full
// text in an invisible copy (onTextLayout on a clamped Text reports the clamped
// line count, so it can't tell us whether it overflowed).
import React, { useCallback, useState } from 'react';
import { StyleProp, StyleSheet, Text, TextStyle, TouchableOpacity, View } from 'react-native';

export function ExpandableText({
  text,
  collapsedLines = 2,
  style,
  toggleColor,
}: {
  text: string;
  collapsedLines?: number;
  style?: StyleProp<TextStyle>;
  toggleColor: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const [fullLines, setFullLines] = useState<number | null>(null);

  const onMeasure = useCallback(
    (e: { nativeEvent: { lines: unknown[] } }) => {
      if (fullLines === null) setFullLines(e.nativeEvent.lines.length);
    },
    [fullLines]
  );

  const needsToggle = (fullLines ?? 0) > collapsedLines;

  return (
    <View>
      <Text style={style} numberOfLines={expanded ? undefined : collapsedLines}>
        {text}
      </Text>

      {fullLines === null ? (
        <Text style={[style, styles.measure]} onTextLayout={onMeasure}>
          {text}
        </Text>
      ) : null}

      {needsToggle ? (
        <TouchableOpacity
          onPress={() => setExpanded((v) => !v)}
          // The row call site renders this at 13/18, which is a 34pt target.
          // hitSlop rather than padding, so neither call site's layout moves.
          hitSlop={{ top: 12, bottom: 12, left: 8, right: 8 }}
          activeOpacity={0.7}
        >
          <Text style={[style, styles.toggle, { color: toggleColor }]}>
            {expanded ? 'Show less' : 'Show more'}
          </Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  measure: {
    position: 'absolute',
    left: 0,
    right: 0,
    opacity: 0,
  },
  toggle: {
    marginTop: 4,
    fontWeight: '600',
    fontStyle: 'normal',
  },
});
