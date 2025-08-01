import * as React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { Provider as PaperProvider } from 'react-native-paper';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import WelcomeScreen from './app/welcome/WelcomeScreen';
import SignUpScreen from './app/welcome/SignUpScreen';
import SignInScreen from './app/welcome/SignInScreen';
import DashboardScreen from './app/tabs/home/DashboardScreen';
import RecommendationTypeScreen from './app/tabs/home/RecommendationTypeScreen';
import AnalyzingScreen from './app/tabs/home/AnalyzingScreen';
import ResultsScreen from './app/tabs/home/ResultsScreen';
import HistoryScreen from './app/tabs/history/HistoryScreen';
import ProfileScreen from './app/tabs/profile/ProfileScreen';
import PaymentScreen from './app/payment/PaymentScreen';
import MainTabs from './app/tabs/MainTabs';

const Stack = createNativeStackNavigator();

export default function App() {
  return (
    <SafeAreaProvider>
      <PaperProvider>
        <NavigationContainer>
          <Stack.Navigator initialRouteName="Welcome" screenOptions={{ headerShown: false }}>
            <Stack.Screen name="Welcome" component={WelcomeScreen} />
            <Stack.Screen name="SignUp" component={SignUpScreen} />
            <Stack.Screen name="SignIn" component={SignInScreen} />
            <Stack.Screen name="Dashboard" component={DashboardScreen} />
            <Stack.Screen name="RecommendationType" component={RecommendationTypeScreen} />
            <Stack.Screen name="Analyzing" component={AnalyzingScreen} />
            <Stack.Screen name="Results" component={ResultsScreen} />
            <Stack.Screen name="History" component={HistoryScreen} />
            <Stack.Screen name="Profile" component={ProfileScreen} />
            <Stack.Screen name="Payment" component={PaymentScreen} />
            <Stack.Screen name="MainTabs" component={MainTabs} />
          </Stack.Navigator>
        </NavigationContainer>
      </PaperProvider>
    </SafeAreaProvider>
  );
}
