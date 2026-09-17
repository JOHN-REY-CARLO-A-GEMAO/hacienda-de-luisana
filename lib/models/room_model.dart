enum RoomStatus {
  available,
  occupied,
  maintenance,
}

extension RoomStatusX on RoomStatus {
  String get displayName {
    switch (this) {
      case RoomStatus.available:
        return 'Available';
      case RoomStatus.occupied:
        return 'Occupied';
      case RoomStatus.maintenance:
        return 'Under Maintenance';
    }
  }

  static RoomStatus fromString(String val) {
    switch (val.toLowerCase()) {
      case 'occupied':
        return RoomStatus.occupied;
      case 'maintenance':
        return RoomStatus.maintenance;
      case 'available':
      default:
        return RoomStatus.available;
    }
  }
}

class RoomModel {
  final String id;
  final String name;
  final int capacity;
  final double pricePerNight;
  final RoomStatus status;
  final String imageUrl;
  final List<String> amenities;

  RoomModel({
    required this.id,
    required this.name,
    required this.capacity,
    required this.pricePerNight,
    required this.status,
    required this.imageUrl,
    this.amenities = const ['Air Conditioning', 'Private Bathroom', 'WiFi', 'Mountain View'],
  });

  factory RoomModel.fromJson(Map<String, dynamic> json, [String? docId]) {
    return RoomModel(
      id: docId ?? json['id'] ?? '',
      name: json['name'] ?? 'Villa LuisAna',
      capacity: (json['capacity'] ?? 6) as int,
      pricePerNight: (json['pricePerNight'] ?? json['price'] ?? 15000.0).toDouble(),
      status: RoomStatusX.fromString((json['status'] ?? 'available').toString()),
      imageUrl: json['imageUrl'] ?? json['image'] ?? 'assets/images/gmaps/img-01.jpg',
      amenities: json['amenities'] != null ? List<String>.from(json['amenities']) : const ['Air Conditioning', 'Private Pool Access', 'WiFi'],
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'id': id,
      'name': name,
      'capacity': capacity,
      'pricePerNight': pricePerNight,
      'status': status.name,
      'imageUrl': imageUrl,
      'amenities': amenities,
    };
  }

  RoomModel copyWith({
    String? id,
    String? name,
    int? capacity,
    double? pricePerNight,
    RoomStatus? status,
    String? imageUrl,
    List<String>? amenities,
  }) {
    return RoomModel(
      id: id ?? this.id,
      name: name ?? this.name,
      capacity: capacity ?? this.capacity,
      pricePerNight: pricePerNight ?? this.pricePerNight,
      status: status ?? this.status,
      imageUrl: imageUrl ?? this.imageUrl,
      amenities: amenities ?? this.amenities,
    );
  }
}
