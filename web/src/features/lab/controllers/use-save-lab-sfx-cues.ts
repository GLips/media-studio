import { useMutation, useQueryClient } from '@tanstack/react-query';
import { labCatalogQueryOptions } from './lab-catalog-query.ts';
import { submitLabSfxCueEdits } from './lab-sfx-cues.ts';

/**
 * Saves the cue editor's edits. A save the server takes becomes the catalog's cue list, so the editor's saved state is
 * the file's; a refusal comes back as the reply, for the editor to say.
 */
export function useSaveLabSfxCues() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: submitLabSfxCueEdits,
    onSuccess: ({ saved }) => {
      if (!saved) return;
      queryClient.setQueryData(labCatalogQueryOptions.queryKey, (catalog) => catalog && { ...catalog, sfxCues: saved });
    },
  });
}
