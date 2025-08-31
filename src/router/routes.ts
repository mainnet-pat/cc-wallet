import { type RouteRecordRaw } from 'vue-router';
import { Buffer } from "buffer/";
// @ts-ignore
window.Buffer = Buffer;

const routes: RouteRecordRaw[] = [
  {
    path: '/',
    component: () => import('pages/WalletPage.vue'),
    props: route => ({ uri: route.query.uri })
  },

  {
    path: '/:catchAll(.*)*',
    component: () => import('pages/ErrorNotFound.vue'),
  },
];

export default routes;
