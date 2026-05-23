export type InspectionPhoto = {
  id: string;
  towerId: string;
  apartmentId: string;
  itemId: string;
  serviceId: string;
  service: string;
  // Display URI (public URL when stored in Supabase Storage, or a data:/file: URI
  // for legacy rows / pre-upload previews).
  uri: string;
  // Path inside the inspection-photos Storage bucket. Empty for legacy rows
  // that still inline the image bytes into uri.
  storagePath: string;
  fileName: string;
  createdAt: string;
  dataHora: string;
  comment: string;
  comentarioFoto: string;
  visitId?: string;
};

export const getInspectionPhotoStorageKey = (apartmentId?: string) =>
  apartmentId ? `fotos-vistoria-${apartmentId}` : undefined;

export const getInspectionPhotosFromStorage = (
  storageKey: string | undefined,
): InspectionPhoto[] => {
  if (!storageKey || typeof window === 'undefined') {
    return [];
  }

  try {
    const storedValue = window.localStorage.getItem(storageKey);

    if (!storedValue) {
      return [];
    }

    const storedPhotos = JSON.parse(storedValue) as Partial<InspectionPhoto>[];

    return storedPhotos.flatMap((photo) => {
      const {
        apartmentId,
        comment,
        comentarioFoto,
        createdAt,
        fileName,
        id,
        itemId,
        service,
        serviceId,
        towerId,
        uri,
        storagePath,
        dataHora,
        visitId,
      } = photo;

      if (
        typeof id !== 'string' ||
        typeof towerId !== 'string' ||
        typeof apartmentId !== 'string' ||
        typeof serviceId !== 'string' ||
        typeof service !== 'string' ||
        typeof uri !== 'string' ||
        typeof fileName !== 'string' ||
        typeof createdAt !== 'string'
      ) {
        return [];
      }

      return [
        {
          id,
          towerId,
          apartmentId,
          itemId: typeof itemId === 'string' ? itemId : serviceId,
          serviceId,
          service,
          uri,
          storagePath: typeof storagePath === 'string' ? storagePath : '',
          fileName,
          createdAt,
          dataHora: typeof dataHora === 'string' ? dataHora : createdAt,
          comment:
            typeof comment === 'string'
              ? comment
              : typeof comentarioFoto === 'string'
                ? comentarioFoto
                : '',
          comentarioFoto:
            typeof comentarioFoto === 'string'
              ? comentarioFoto
              : typeof comment === 'string'
                ? comment
                : '',
          visitId: typeof visitId === 'string' ? visitId : undefined,
        },
      ];
    });
  } catch {
    return [];
  }
};

export const saveInspectionPhotosToStorage = (
  storageKey: string | undefined,
  photos: InspectionPhoto[],
) => {
  if (!storageKey || typeof window === 'undefined') {
    return;
  }

  window.localStorage.setItem(storageKey, JSON.stringify(photos));
};
