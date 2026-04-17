import React, { useMemo } from 'react';
import { View, StyleSheet, NativeSyntheticEvent } from 'react-native';
import NativeSegmentedControl from '../codegen/SegmentControlNativeComponent';
import { useTheme } from './themes';

interface SegmentedControlProps {
  values: string[];
  selectedIndex: number;
  onChange: (index: number) => void;
}

interface SegmentedControlEvent {
  selectedIndex: number;
}

const SegmentedControl: React.FC<SegmentedControlProps> = ({ values, selectedIndex, onChange }) => {
  const { colors } = useTheme();
  const handleChange = useMemo(
    () => (event: NativeSyntheticEvent<SegmentedControlEvent>) => {
      if (event?.nativeEvent?.selectedIndex !== undefined) {
        onChange(event.nativeEvent.selectedIndex);
      }
    },
    [onChange],
  );

  if (!Array.isArray(values) || values.length === 0) {
    return null;
  }

  return (
    <View style={styles.container}>
      <NativeSegmentedControl
        values={values}
        selectedIndex={selectedIndex}
        enabled
        backgroundColor={colors.backgroundPrimary}
        tintColor={colors.accentPrimary}
        textColor={colors.accentPrimary}
        momentary={false}
        style={styles.segmentedControl}
        onChange={handleChange}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    width: '100%',
    marginHorizontal: 0,
    marginBottom: 18,
    minHeight: 40,
  },
  segmentedControl: {
    height: 40,
  },
});

export default SegmentedControl;
