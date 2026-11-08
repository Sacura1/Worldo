import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({plugins:[react()],server:{port:5173,fs:{deny:['**/.env*','**/*.{crt,pem,key}','**/.git/**','**/.local/**','**/test-results/**','**/playwright-report/**','**/contracts/target/**']},watch:{ignored:['**/.local/**','**/contracts/target/**']},proxy:{'/api':'http://localhost:3000','/chain':'http://localhost:3000'}},build:{chunkSizeWarningLimit:700,rollupOptions:{output:{manualChunks:{three:['three'],react:['react','react-dom']}}}}});
