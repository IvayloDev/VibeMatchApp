import { registerRootComponent } from 'expo';
import { LogBox, Platform } from 'react-native';

import App from './App';

// Ignore customLogHandler warning - it's a known non-critical issue
LogBox.ignoreLogs(['customLogHandler is not a function']);

// Disable debug overlays in production and development builds
// This prevents React Native inspector overlays from appearing
if (Platform.OS === 'ios' || Platform.OS === 'android') {
  try {
    // Disable React Native inspector
    if (typeof global !== 'undefined') {
      // Disable element inspector
      if (global.__RCTProfileIsProfiling !== undefined) {
        global.__RCTProfileIsProfiling = false;
      }
      
      // Disable inspector overlays
      if (global.__REACT_DEVTOOLS_GLOBAL_HOOK__) {
        delete global.__REACT_DEVTOOLS_GLOBAL_HOOK__;
      }
      
      // Disable any inspector state
      if (global.Inspector !== undefined) {
        global.Inspector = undefined;
      }
    }
  } catch (e) {
    // Ignore errors if inspector globals don't exist
  }
}

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);
