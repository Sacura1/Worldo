process.env.NODE_ENV ||= 'production';
const {createApp} = await import('../server/index.ts');
const port = Number(process.env.PORT || 3000);
const app = await createApp();
app.listen(port,'0.0.0.0',()=>console.log(`Worldo is running at http://localhost:${port}`));
