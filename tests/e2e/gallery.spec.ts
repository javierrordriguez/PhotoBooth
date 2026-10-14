import {test,expect} from '@playwright/test';
import jpeg from 'jpeg-js';
const a='a'.repeat(64),b='b'.repeat(64);
const picture=jpeg.encode({width:2,height:2,data:new Uint8Array(16).fill(255)},90).data;
test('galería móvil espera cinco archivos, descarga imágenes/ZIP y aísla enlaces',async({page})=>{
 await page.setViewportSize({width:390,height:844});let ready=false;
 await page.route('**/functions/v1/guest-gallery',async route=>{
  const token=route.request().postDataJSON().token;
  await route.fulfill({json:token!==a?{state:'revoked'}:!ready?{state:'preparing'}:{state:'ready',name:'Tami',photos:Array.from({length:5},(_,position)=>({position,size:picture.length,url:`https://images.example/${position}.jpg`}))}});
 });
 await page.route('https://images.example/**',route=>route.fulfill({contentType:'image/jpeg',body:picture}));
 await page.goto('/s/'+a);await expect(page.getByText('Ya casi están')).toBeVisible();expect(await page.locator('img').count()).toBe(0);
 ready=true;await page.getByRole('button',{name:'Actualizar',exact:true}).click();await expect(page.locator('img')).toHaveCount(5);
 const zip=page.waitForEvent('download');await page.getByRole('button',{name:'Descargar mis cinco imágenes'}).click();expect((await zip).suggestedFilename()).toBe('recuerdos-tami.zip');
 const single=page.waitForEvent('download');await page.getByRole('button',{name:'Descargar',exact:true}).first().click();expect((await single).suggestedFilename()).toBe('tira.jpg');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.goto('/s/'+b);await expect(page.getByText('El organizador desactivó este enlace.')).toBeVisible();await expect(page.locator('img')).toHaveCount(0);
});
test('la galería informa error de red y permite reintentar sin exponer imágenes',async({page})=>{
 await page.route('**/functions/v1/guest-gallery',route=>route.abort());await page.goto('/s/'+a);await expect(page.getByText('No pudimos conectar. Revisá Internet y reintentá.')).toBeVisible();
 await page.unroute('**/functions/v1/guest-gallery');await page.route('**/functions/v1/guest-gallery',route=>route.fulfill({json:{state:'expired'}}));await page.getByRole('button',{name:'Actualizar'}).click();await expect(page.getByText('Este enlace venció. Contactá al organizador.')).toBeVisible();await expect(page.locator('img')).toHaveCount(0);
});
