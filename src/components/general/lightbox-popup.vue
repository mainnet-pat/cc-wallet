<script setup lang="ts">
  export interface LightboxButton {
    label: string
    action: () => void
    variant?: 'default' | 'danger'
  }

  defineProps<{
    modelValue: boolean
    icon?: string
    title?: string
    buttons?: LightboxButton[]
    blur?: boolean
  }>()

  defineEmits<{
    'update:modelValue': [value: boolean]
  }>()
</script>

<template>
  <Teleport to="body">
    <Transition name="lightbox-fade">
      <div v-if="modelValue" class="lightbox-overlay" :class="{ 'no-blur': blur === false }">
        <div class="lightbox-box">
          <div v-if="icon" class="lightbox-icon">
            <img :src="icon" alt="" />
          </div>

          <div v-if="title" class="lightbox-title">{{ title }}</div>

          <div class="lightbox-body">
            <slot />
          </div>

          <div v-if="buttons?.length" class="lightbox-buttons">
            <button
              v-for="btn in buttons"
              :key="btn.label"
              class="lightbox-btn"
              :class="btn.variant === 'danger' ? 'lightbox-btn-danger' : 'lightbox-btn-default'"
              @click="btn.action"
            >
              {{ btn.label }}
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.lightbox-overlay {
  position: fixed;
  inset: 0;
  z-index: 9999;
  display: flex;
  align-items: center;
  justify-content: center;
  backdrop-filter: blur(5px);
  background-color: rgba(0, 0, 0, 0.35);
}
.lightbox-overlay.no-blur {
  backdrop-filter: none;
}

.lightbox-box {
  width: 80%;
  max-width: 320px;
  background-color: #2aa9e1;
  /* border-radius: 18px; */
  padding: 2.5rem 2rem;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1.2rem;
  color: #fff;
  box-shadow: 0 8px 40px rgba(0, 0, 0, 0.45);
}

.lightbox-icon img {
  width: 72px;
  height: 72px;
  object-fit: contain;
}

.lightbox-title {
  font-size: 1.2rem;
  font-weight: 700;
  /* text-align: center; */
  line-height: 1.4;
  color: #fff;
}

.lightbox-body {
  font-size: 1.4rem;
  /* text-align: center; */
  line-height: 1.6;
  color: #fff;
  width: 100%;
}

.lightbox-buttons {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 0.75rem;
  width: 100%;
  margin-top: 0.5rem;
}

.lightbox-btn {
  flex: 0 0 auto;
  min-width: 120px;
  padding: 0.85rem 1.2rem;
  border: none;
  border-radius: 5px;
  font-size: 1.3rem;
  cursor: pointer;
  text-align: center;
  transition: opacity 0.15s;
}

.lightbox-btn:hover {
  opacity: 0.88;
}

.lightbox-btn-default {
  background-color: #fff;
  color: #2aa9e1;
}

.lightbox-btn-danger {
  background-color: #e03c31;
  color: #fff;
}

/* Transition */
.lightbox-fade-enter-active,
.lightbox-fade-leave-active {
  transition: opacity 0.2s ease;
}
.lightbox-fade-enter-from,
.lightbox-fade-leave-to {
  opacity: 0;
}
</style>
