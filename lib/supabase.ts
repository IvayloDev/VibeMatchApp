import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://mebjzwwtuzwcrwugxjvu.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1lYmp6d3d0dXp3Y3J3dWd4anZ1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTI5Mzg2NDAsImV4cCI6MjA2ODUxNDY0MH0.x7GFKp-YC89d1Y-p9VNzDwfyOuWR34xd9b_t4ylFn6g';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
